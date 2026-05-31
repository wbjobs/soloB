use clap::{Parser, Subcommand};
use rand::prelude::*;
use std::fs;
use std::io;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "dungeon-gen")]
#[command(about = "生成 Roguelike 风格地牢地图的命令行工具")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    #[arg(long, default_value_t = 50)]
    width: usize,

    #[arg(long, default_value_t = 30)]
    height: usize,

    #[arg(long, default_value = "map.txt")]
    output: PathBuf,

    #[arg(long, default_value = "bsp")]
    algorithm: String,
}

#[derive(Subcommand)]
enum Commands {
    Validate {
        #[arg(required = true)]
        file: PathBuf,
    },
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    x: usize,
    y: usize,
    w: usize,
    h: usize,
}

impl Rect {
    fn new(x: usize, y: usize, w: usize, h: usize) -> Self {
        Rect { x, y, w, h }
    }

    fn center(&self) -> (usize, usize) {
        (self.x + self.w / 2, self.y + self.h / 2)
    }

    fn right(&self) -> usize {
        self.x + self.w
    }

    fn bottom(&self) -> usize {
        self.y + self.h
    }
}

enum BspNode {
    Leaf {
        region: Rect,
        room: Rect,
    },
    Internal {
        region: Rect,
        left: Box<BspNode>,
        right: Box<BspNode>,
        split_horizontal: bool,
        split_pos: usize,
    },
}

impl BspNode {
    fn region(&self) -> &Rect {
        match self {
            BspNode::Leaf { region, .. } => region,
            BspNode::Internal { region, .. } => region,
        }
    }
}

fn initialize_map(width: usize, height: usize) -> Vec<Vec<char>> {
    vec![vec!['#'; width]; height]
}

fn carve_room(map: &mut Vec<Vec<char>>, room: &Rect) {
    for y in room.y..room.bottom() {
        for x in room.x..room.right() {
            if y < map.len() && x < map[y].len() {
                map[y][x] = '.';
            }
        }
    }
}

fn carve_h_corridor(map: &mut Vec<Vec<char>>, x1: usize, x2: usize, y: usize) {
    let start = x1.min(x2);
    let end = x1.max(x2);
    for x in start..=end {
        if y < map.len() && x < map[y].len() {
            map[y][x] = '.';
        }
    }
}

fn carve_v_corridor(map: &mut Vec<Vec<char>>, y1: usize, y2: usize, x: usize) {
    let start = y1.min(y2);
    let end = y1.max(y2);
    for y in start..=end {
        if y < map.len() && x < map[y].len() {
            map[y][x] = '.';
        }
    }
}

fn build_bsp_tree<R: Rng>(
    region: Rect,
    min_room_size: usize,
    max_room_size: usize,
    depth: usize,
    max_depth: usize,
    rng: &mut R,
) -> BspNode {
    if depth >= max_depth {
        let room = create_room_in_region(&region, min_room_size, max_room_size, rng);
        return BspNode::Leaf { region, room };
    }

    let can_split_h = region.h >= min_room_size * 2 + 1;
    let can_split_v = region.w >= min_room_size * 2 + 1;

    if !can_split_h && !can_split_v {
        let room = create_room_in_region(&region, min_room_size, max_room_size, rng);
        return BspNode::Leaf { region, room };
    }

    let split_horizontal = if can_split_h && can_split_v {
        rng.gen_bool(0.5)
    } else {
        can_split_h
    };

    if split_horizontal {
        let min_split = min_room_size + 1;
        let max_split = region.h - min_room_size - 1;
        if max_split <= min_split {
            let room = create_room_in_region(&region, min_room_size, max_room_size, rng);
            return BspNode::Leaf { region, room };
        }
        let split_pos = rng.gen_range(min_split..max_split);

        let top_region = Rect::new(region.x, region.y, region.w, split_pos);
        let bottom_region = Rect::new(
            region.x,
            region.y + split_pos + 1,
            region.w,
            region.h - split_pos - 1,
        );

        let left = Box::new(build_bsp_tree(
            top_region,
            min_room_size,
            max_room_size,
            depth + 1,
            max_depth,
            rng,
        ));
        let right = Box::new(build_bsp_tree(
            bottom_region,
            min_room_size,
            max_room_size,
            depth + 1,
            max_depth,
            rng,
        ));

        BspNode::Internal {
            region,
            left,
            right,
            split_horizontal: true,
            split_pos,
        }
    } else {
        let min_split = min_room_size + 1;
        let max_split = region.w - min_room_size - 1;
        if max_split <= min_split {
            let room = create_room_in_region(&region, min_room_size, max_room_size, rng);
            return BspNode::Leaf { region, room };
        }
        let split_pos = rng.gen_range(min_split..max_split);

        let left_region = Rect::new(region.x, region.y, split_pos, region.h);
        let right_region = Rect::new(
            region.x + split_pos + 1,
            region.y,
            region.w - split_pos - 1,
            region.h,
        );

        let left = Box::new(build_bsp_tree(
            left_region,
            min_room_size,
            max_room_size,
            depth + 1,
            max_depth,
            rng,
        ));
        let right = Box::new(build_bsp_tree(
            right_region,
            min_room_size,
            max_room_size,
            depth + 1,
            max_depth,
            rng,
        ));

        BspNode::Internal {
            region,
            left,
            right,
            split_horizontal: false,
            split_pos,
        }
    }
}

fn create_room_in_region<R: Rng>(
    region: &Rect,
    min_room_size: usize,
    max_room_size: usize,
    rng: &mut R,
) -> Rect {
    let room_w_min = min_room_size.min(region.w);
    let room_w_max = max_room_size.min(region.w);
    let room_h_min = min_room_size.min(region.h);
    let room_h_max = max_room_size.min(region.h);

    let room_w = if room_w_max > room_w_min {
        rng.gen_range(room_w_min..=room_w_max)
    } else {
        room_w_min
    };
    let room_h = if room_h_max > room_h_min {
        rng.gen_range(room_h_min..=room_h_max)
    } else {
        room_h_min
    };

    let room_x = if region.w > room_w {
        region.x + rng.gen_range(0..=region.w - room_w)
    } else {
        region.x
    };
    let room_y = if region.h > room_h {
        region.y + rng.gen_range(0..=region.h - room_h)
    } else {
        region.y
    };

    Rect::new(room_x, room_y, room_w, room_h)
}

fn carve_tree(map: &mut Vec<Vec<char>>, node: &BspNode, rooms: &mut Vec<Rect>) {
    match node {
        BspNode::Leaf { room, .. } => {
            carve_room(map, room);
            rooms.push(*room);
        }
        BspNode::Internal {
            left, right, split_horizontal, split_pos, ..
        } => {
            carve_tree(map, left, rooms);
            carve_tree(map, right, rooms);

            let left_room = get_any_room(left);
            let right_room = get_any_room(right);

            let (lx, ly) = left_room.center();
            let (rx, ry) = right_room.center();

            if *split_horizontal {
                let corridor_y = node.region().y + split_pos;
                carve_v_corridor(map, ly, corridor_y, lx);
                carve_h_corridor(map, lx, rx, corridor_y);
                carve_v_corridor(map, corridor_y, ry, rx);
            } else {
                let corridor_x = node.region().x + split_pos;
                carve_h_corridor(map, lx, corridor_x, ly);
                carve_v_corridor(map, ly, ry, corridor_x);
                carve_h_corridor(map, corridor_x, rx, ry);
            }
        }
    }
}

fn get_any_room(node: &BspNode) -> Rect {
    match node {
        BspNode::Leaf { room, .. } => *room,
        BspNode::Internal { left, .. } => get_any_room(left),
    }
}

fn count_leaves(node: &BspNode) -> usize {
    match node {
        BspNode::Leaf { .. } => 1,
        BspNode::Internal { left, right, .. } => count_leaves(left) + count_leaves(right),
    }
}

fn generate_bsp_dungeon(width: usize, height: usize) -> (Vec<Vec<char>>, Vec<Rect>) {
    let mut rng = thread_rng();
    let mut map = initialize_map(width, height);

    let min_room_size = 4;
    let max_room_size = 10;
    let max_depth = 5;

    let margin = 1;
    let root_region = Rect::new(
        margin,
        margin,
        width - margin * 2,
        height - margin * 2,
    );

    let mut tree;
    let mut rooms = Vec::new();

    loop {
        tree = build_bsp_tree(
            root_region,
            min_room_size,
            max_room_size,
            0,
            max_depth,
            &mut rng,
        );
        let leaf_count = count_leaves(&tree);
        if leaf_count >= 3 {
            break;
        }
    }

    carve_tree(&mut map, &tree, &mut rooms);

    (map, rooms)
}

fn count_wall_neighbors(map: &[Vec<char>], x: usize, y: usize) -> usize {
    let height = map.len();
    let width = if height > 0 { map[0].len() } else { 0 };
    let mut count = 0;

    for dy in -1..=1 {
        for dx in -1..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx < 0 || ny < 0 || nx >= width as i32 || ny >= height as i32 {
                count += 1;
            } else if map[ny as usize][nx as usize] == '#' {
                count += 1;
            }
        }
    }

    count
}

fn cellular_automata_step(map: &[Vec<char>], birth_rule: usize, survival_rule: usize) -> Vec<Vec<char>> {
    let height = map.len();
    let width = if height > 0 { map[0].len() } else { 0 };
    let mut new_map = vec![vec!['#'; width]; height];

    for y in 0..height {
        for x in 0..width {
            let neighbors = count_wall_neighbors(map, x, y);
            if map[y][x] == '.' {
                if neighbors < survival_rule {
                    new_map[y][x] = '#';
                } else {
                    new_map[y][x] = '.';
                }
            } else {
                if neighbors > birth_rule {
                    new_map[y][x] = '#';
                } else {
                    new_map[y][x] = '.';
                }
            }
        }
    }

    new_map
}

fn get_connected_components(map: &[Vec<char>]) -> Vec<Vec<(usize, usize)>> {
    let height = map.len();
    let width = if height > 0 { map[0].len() } else { 0 };
    let mut visited = vec![vec![false; width]; height];
    let mut components = Vec::new();

    for y in 0..height {
        for x in 0..width {
            if map[y][x] == '.' && !visited[y][x] {
                let mut component = Vec::new();
                let mut stack = vec![(x, y)];

                while let Some((cx, cy)) = stack.pop() {
                    if visited[cy][cx] {
                        continue;
                    }
                    visited[cy][cx] = true;
                    component.push((cx, cy));

                    let neighbors = [
                        (cx.wrapping_sub(1), cy),
                        (cx + 1, cy),
                        (cx, cy.wrapping_sub(1)),
                        (cx, cy + 1),
                    ];

                    for (nx, ny) in neighbors {
                        if nx < width && ny < height && map[ny][nx] == '.' && !visited[ny][nx] {
                            stack.push((nx, ny));
                        }
                    }
                }

                components.push(component);
            }
        }
    }

    components
}

fn find_closest_points(a: &[(usize, usize)], b: &[(usize, usize)]) -> ((usize, usize), (usize, usize)) {
    let mut best_pair = (a[0], b[0]);
    let mut best_dist = usize::MAX;

    for &p1 in a {
        for &p2 in b {
            let dist = (p1.0 as i32 - p2.0 as i32).abs() as usize
                + (p1.1 as i32 - p2.1 as i32).abs() as usize;
            if dist < best_dist {
                best_dist = dist;
                best_pair = (p1, p2);
            }
        }
    }

    best_pair
}

fn connect_components(map: &mut Vec<Vec<char>>, components: &[Vec<(usize, usize)>]) {
    if components.len() <= 1 {
        return;
    }

    let main_idx = components
        .iter()
        .enumerate()
        .max_by_key(|(_, c)| c.len())
        .map(|(i, _)| i)
        .unwrap_or(0);

    for (i, component) in components.iter().enumerate() {
        if i == main_idx {
            continue;
        }

        let (p1, p2) = find_closest_points(&components[main_idx], component);
        let mut rng = thread_rng();

        if rng.gen_bool(0.5) {
            carve_h_corridor(map, p1.0, p2.0, p1.1);
            carve_v_corridor(map, p1.1, p2.1, p2.0);
        } else {
            carve_v_corridor(map, p1.1, p2.1, p1.0);
            carve_h_corridor(map, p1.0, p2.0, p2.1);
        }
    }
}

fn count_ca_rooms(map: &[Vec<char>]) -> usize {
    let height = map.len();
    let width = if height > 0 { map[0].len() } else { 0 };

    let mut visited = vec![vec![false; width]; height];
    let mut room_count = 0;

    for y in 0..height {
        for x in 0..width {
            if map[y][x] == '.' && !visited[y][x] {
                let mut stack = vec![(x, y)];
                let mut size = 0;
                let mut min_x = width;
                let mut max_x = 0;
                let mut min_y = height;
                let mut max_y = 0;

                while let Some((cx, cy)) = stack.pop() {
                    if visited[cy][cx] {
                        continue;
                    }
                    visited[cy][cx] = true;
                    size += 1;
                    min_x = min_x.min(cx);
                    max_x = max_x.max(cx);
                    min_y = min_y.min(cy);
                    max_y = max_y.max(cy);

                    let neighbors = [
                        (cx.wrapping_sub(1), cy),
                        (cx + 1, cy),
                        (cx, cy.wrapping_sub(1)),
                        (cx, cy + 1),
                    ];

                    for (nx, ny) in neighbors {
                        if nx < width && ny < height && map[ny][nx] == '.' && !visited[ny][nx] {
                            stack.push((nx, ny));
                        }
                    }
                }

                let bounding_w = max_x - min_x + 1;
                let bounding_h = max_y - min_y + 1;

                if size >= 16 && bounding_w >= 4 && bounding_h >= 4 {
                    room_count += 1;
                }
            }
        }
    }

    room_count
}

fn generate_cellular_dungeon(width: usize, height: usize) -> (Vec<Vec<char>>, Vec<Rect>) {
    let mut rng = thread_rng();
    let mut map;

    loop {
        map = initialize_map(width, height);

        let wall_density = 0.45;
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                if rng.gen::<f64>() > wall_density {
                    map[y][x] = '.';
                }
            }
        }

        for _ in 0..4 {
            map = cellular_automata_step(&map, 4, 4);
        }

        for _ in 0..3 {
            map = cellular_automata_step(&map, 5, 5);
        }

        let components = get_connected_components(&map);
        connect_components(&mut map, &components);

        let room_count = count_ca_rooms(&map);
        if room_count >= 3 && is_connected(&map) {
            break;
        }
    }

    (map, Vec::new())
}

fn count_rooms(map: &[Vec<char>]) -> usize {
    let height = map.len();
    let width = if height > 0 { map[0].len() } else { 0 };

    let mut visited = vec![vec![false; width]; height];
    let mut room_count = 0;

    for y in 0..height {
        for x in 0..width {
            if map[y][x] == '.' && !visited[y][x] {
                let mut stack = vec![(x, y)];
                let mut size = 0;
                let mut min_x = width;
                let mut max_x = 0;
                let mut min_y = height;
                let mut max_y = 0;

                while let Some((cx, cy)) = stack.pop() {
                    if visited[cy][cx] {
                        continue;
                    }
                    visited[cy][cx] = true;
                    size += 1;
                    min_x = min_x.min(cx);
                    max_x = max_x.max(cx);
                    min_y = min_y.min(cy);
                    max_y = max_y.max(cy);

                    let neighbors = [
                        (cx.wrapping_sub(1), cy),
                        (cx + 1, cy),
                        (cx, cy.wrapping_sub(1)),
                        (cx, cy + 1),
                    ];

                    for (nx, ny) in neighbors {
                        if nx < width && ny < height && map[ny][nx] == '.' && !visited[ny][nx] {
                            stack.push((nx, ny));
                        }
                    }
                }

                let bounding_w = max_x - min_x + 1;
                let bounding_h = max_y - min_y + 1;

                if size >= 16 && bounding_w >= 4 && bounding_h >= 4 {
                    room_count += 1;
                }
            }
        }
    }

    room_count
}

fn is_connected(map: &[Vec<char>]) -> bool {
    let height = map.len();
    if height == 0 {
        return true;
    }
    let width = map[0].len();

    let mut start: Option<(usize, usize)> = None;
    'outer: for y in 0..height {
        for x in 0..width {
            if map[y][x] == '.' {
                start = Some((x, y));
                break 'outer;
            }
        }
    }

    let start = match start {
        Some(s) => s,
        None => return true,
    };

    let mut visited = vec![vec![false; width]; height];
    let mut stack = vec![start];
    let mut reachable = 0;

    while let Some((cx, cy)) = stack.pop() {
        if visited[cy][cx] {
            continue;
        }
        visited[cy][cx] = true;
        reachable += 1;

        let neighbors = [
            (cx.wrapping_sub(1), cy),
            (cx + 1, cy),
            (cx, cy.wrapping_sub(1)),
            (cx, cy + 1),
        ];

        for (nx, ny) in neighbors {
            if nx < width && ny < height && map[ny][nx] == '.' && !visited[ny][nx] {
                stack.push((nx, ny));
            }
        }
    }

    let total_floor: usize = map
        .iter()
        .map(|row| row.iter().filter(|&&c| c == '.').count())
        .sum();
    reachable == total_floor
}

fn validate_map(file_path: &PathBuf) -> io::Result<()> {
    let content = fs::read_to_string(file_path)?;
    let map: Vec<Vec<char>> = content
        .lines()
        .map(|line| line.chars().collect())
        .collect();

    if map.is_empty() {
        println!("验证失败: 地图为空");
        std::process::exit(1);
    }

    let connected = is_connected(&map);
    let room_count = count_rooms(&map);

    println!("连通性: {}", if connected { "通过" } else { "失败" });
    println!("房间数量: {}", room_count);

    if !connected {
        println!("验证失败: 地图不是完全连通的");
        std::process::exit(1);
    }

    if room_count < 3 {
        println!("验证失败: 房间数量不足 3 个");
        std::process::exit(1);
    }

    println!("验证通过!");
    Ok(())
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Validate { file }) => {
            if let Err(e) = validate_map(&file) {
                eprintln!("读取地图文件失败: {}", e);
                std::process::exit(1);
            }
        }
        None => {
            let (map, rooms) = match cli.algorithm.to_lowercase().as_str() {
                "bsp" => generate_bsp_dungeon(cli.width, cli.height),
                "cellular" | "ca" => generate_cellular_dungeon(cli.width, cli.height),
                _ => {
                    eprintln!("未知算法: {}", cli.algorithm);
                    eprintln!("可用算法: bsp, cellular (或 ca)");
                    std::process::exit(1);
                }
            };

            let content: String = map
                .iter()
                .map(|row| row.iter().collect::<String>())
                .collect::<Vec<_>>()
                .join("\n");

            if let Err(e) = fs::write(&cli.output, content) {
                eprintln!("写入文件失败: {}", e);
                std::process::exit(1);
            }

            println!("地牢已生成，保存到 {:?}", cli.output);
            println!("地图尺寸: {} x {}", cli.width, cli.height);
            println!("使用算法: {}", cli.algorithm);
            if !rooms.is_empty() {
                println!("房间数量: {}", rooms.len());
            }
        }
    }
}
