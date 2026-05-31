use libp2p::{
    gossipsub::{
        self, Gossipsub, GossipsubConfig, GossipsubEvent, IdentTopic as Topic,
        MessageAuthenticity, ValidationMode,
    },
    identity,
    mdns::{self, Mdns, MdnsEvent},
    swarm::{NetworkBehaviour, SwarmBuilder, SwarmEvent},
    tcp::async_io::Transport as TcpTransport,
    PeerId,
};
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter};
use crate::models::{NoteMessage, NoteAction};
use sqlx::SqlitePool;

#[derive(NetworkBehaviour)]
#[behaviour(out_event = "AppBehaviourEvent")]
pub struct AppBehaviour {
    gossipsub: Gossipsub,
    mdns: Mdns,
}

#[derive(Debug)]
pub enum AppBehaviourEvent {
    Gossipsub(GossipsubEvent),
    Mdns(MdnsEvent),
}

impl From<GossipsubEvent> for AppBehaviourEvent {
    fn from(event: GossipsubEvent) -> Self {
        AppBehaviourEvent::Gossipsub(event)
    }
}

impl From<MdnsEvent> for AppBehaviourEvent {
    fn from(event: MdnsEvent) -> Self {
        AppBehaviourEvent::Mdns(event)
    }
}

#[derive(Debug)]
pub enum P2PCommand {
    Publish(NoteMessage),
}

pub const TOPIC_NAME: &str = "p2p-notes";

pub async fn run_p2p(
    app_handle: AppHandle,
    db_pool: SqlitePool,
    mut rx: mpsc::UnboundedReceiver<P2PCommand>,
) -> anyhow::Result<()> {
    let local_key = identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(local_key.public());
    
    println!("Local peer id: {:?}", local_peer_id);

    let transport = TcpTransport::default()
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(libp2p::noise::Config::new(&local_key)?)
        .multiplex(libp2p::yamux::Config::default())
        .boxed();

    let topic = Topic::new(TOPIC_NAME);

    let gossipsub = Gossipsub::new(
        MessageAuthenticity::Signed(local_key.clone()),
        GossipsubConfig::default(),
    )?;

    let mdns = Mdns::new(Default::default(), local_peer_id).await?;

    let mut behaviour = AppBehaviour { gossipsub, mdns };
    behaviour.gossipsub.subscribe(&topic)?;

    let mut swarm = SwarmBuilder::with_async_std_executor(transport, behaviour, local_peer_id).build();

    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    loop {
        tokio::select! {
            event = swarm.select_next_some() => {
                match event {
                    SwarmEvent::Behaviour(AppBehaviourEvent::Mdns(MdnsEvent::Discovered(peers))) => {
                        for (peer, _addr) in peers {
                            println!("Discovered peer: {:?}", peer);
                            swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer);
                        }
                    }
                    SwarmEvent::Behaviour(AppBehaviourEvent::Mdns(MdnsEvent::Expired(peers))) => {
                        for (peer, _addr) in peers {
                            println!("Expired peer: {:?}", peer);
                            swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer);
                        }
                    }
                    SwarmEvent::Behaviour(AppBehaviourEvent::Gossipsub(GossipsubEvent::Message {
                        propagation_source: peer_id,
                        message_id: _id,
                        message,
                    })) => {
                        if let Ok(note_message) = serde_json::from_slice::<NoteMessage>(&message.data) {
                            println!("Received note from {:?}: {:?}", peer_id, note_message);
                            handle_incoming_message(&app_handle, &db_pool, note_message).await;
                        }
                    }
                    _ => {}
                }
            }
            cmd = rx.recv() => {
                if let Some(P2PCommand::Publish(note_message)) = cmd {
                    let data = serde_json::to_vec(&note_message)?;
                    swarm.behaviour_mut().gossipsub.publish(topic.clone(), data)?;
                    println!("Published note: {:?}", note_message);
                }
            }
        }
    }
}

fn parse_timestamp(ts: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

fn is_remote_newer(remote_updated_at: &str, local_updated_at: &str) -> bool {
    match (parse_timestamp(remote_updated_at), parse_timestamp(local_updated_at)) {
        (Some(remote), Some(local)) => remote > local,
        (Some(_), None) => true,
        _ => false,
    }
}

async fn handle_incoming_message(
    app_handle: &AppHandle,
    db_pool: &SqlitePool,
    msg: NoteMessage,
) {
    let local_note = crate::db::get_note(db_pool, &msg.note.id)
        .await
        .unwrap_or(None);

    let result = match msg.action {
        NoteAction::Create => {
            match local_note {
                None => {
                    let _ = sqlx::query(
                        r#"
                        INSERT INTO notes (id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        "#,
                    )
                    .bind(&msg.note.id)
                    .bind(&msg.note.title)
                    .bind(&msg.note.content)
                    .bind(&msg.note.created_at)
                    .bind(&msg.note.updated_at)
                    .execute(db_pool)
                    .await;
                    Some(("note-created", msg.note))
                }
                Some(existing) => {
                    if is_remote_newer(&msg.note.updated_at, &existing.updated_at) {
                        let _ = crate::db::add_to_history(db_pool, &existing).await;
                        let _ = sqlx::query(
                            r#"
                            UPDATE notes
                            SET title = ?, content = ?, created_at = ?, updated_at = ?
                            WHERE id = ?
                            "#,
                        )
                        .bind(&msg.note.title)
                        .bind(&msg.note.content)
                        .bind(&msg.note.created_at)
                        .bind(&msg.note.updated_at)
                        .bind(&msg.note.id)
                        .execute(db_pool)
                        .await;
                        Some(("note-updated", msg.note))
                    } else {
                        None
                    }
                }
            }
        }
        NoteAction::Update => {
            match local_note {
                None => {
                    let _ = sqlx::query(
                        r#"
                        INSERT INTO notes (id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        "#,
                    )
                    .bind(&msg.note.id)
                    .bind(&msg.note.title)
                    .bind(&msg.note.content)
                    .bind(&msg.note.created_at)
                    .bind(&msg.note.updated_at)
                    .execute(db_pool)
                    .await;
                    Some(("note-created", msg.note))
                }
                Some(existing) => {
                    if is_remote_newer(&msg.note.updated_at, &existing.updated_at) {
                        let _ = crate::db::add_to_history(db_pool, &existing).await;
                        let _ = sqlx::query(
                            r#"
                            UPDATE notes
                            SET title = ?, content = ?, updated_at = ?
                            WHERE id = ?
                            "#,
                        )
                        .bind(&msg.note.title)
                        .bind(&msg.note.content)
                        .bind(&msg.note.updated_at)
                        .bind(&msg.note.id)
                        .execute(db_pool)
                        .await;
                        Some(("note-updated", msg.note))
                    } else {
                        None
                    }
                }
            }
        }
        NoteAction::Delete => {
            match local_note {
                None => None,
                Some(existing) => {
                    if is_remote_newer(&msg.note.updated_at, &existing.updated_at) {
                        let _ = crate::db::add_to_history(db_pool, &existing).await;
                        let _ = sqlx::query(
                            r#"
                            DELETE FROM notes WHERE id = ?
                            "#,
                        )
                        .bind(&msg.note.id)
                        .execute(db_pool)
                        .await;
                        Some(("note-deleted", msg.note))
                    } else {
                        None
                    }
                }
            }
        }
    };

    if let Some((event, note)) = result {
        let _ = app_handle.emit(event, note);
    }
}