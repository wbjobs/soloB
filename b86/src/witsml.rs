use crate::{Formations, LasData, Result};
use chrono::{DateTime, Utc};
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, Event};
use quick_xml::Writer;
use std::io::Cursor;

pub fn export_to_witsml(
    well_name: &str,
    well_uid: &str,
    las_data: &LasData,
    formations: &Formations,
) -> Result<String> {
    let mut buffer = Vec::new();
    let mut writer = Writer::new_with_indent(Cursor::new(&mut buffer), b' ', 2);

    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;

    let logs = BytesStart::new("logs")
        .with_attribute(("xmlns", "http://www.witsml.org/schemas/1series"))
        .with_attribute(("version", "1.4.1.1"));
    writer.write_event(Event::Start(logs))?;

    let log = BytesStart::new("log")
        .with_attribute(("uidWell", well_uid))
        .with_attribute(("uidWellbore", well_uid))
        .with_attribute(("uid", format!("{}-log", well_uid)));
    writer.write_event(Event::Start(log))?;

    write_simple_element(&mut writer, "nameWell", well_name)?;
    write_simple_element(&mut writer, "nameWellbore", &format!("{} Wellbore", well_name))?;
    write_simple_element(&mut writer, "name", &format!("{} Log Data", well_name))?;

    let now: DateTime<Utc> = Utc::now();
    write_simple_element(&mut writer, "creationDate", &now.to_rfc3339())?;

    let mut mnemonics = vec!["DEPTH".to_string()];
    let mut units = vec!["m".to_string()];

    for (name, curve) in &las_data.curves {
        mnemonics.push(name.clone());
        units.push(curve.unit.clone());
    }

    let log_curves_info = BytesStart::new("logCurveInfo")
        .with_attribute(("uid", "DEPTH"));
    writer.write_event(Event::Start(log_curves_info))?;
    write_simple_element(&mut writer, "mnemonic", "DEPTH")?;
    write_simple_element(&mut writer, "unit", "m")?;
    write_simple_element(&mut writer, "curveDescription", "Measured Depth")?;
    write_simple_element(&mut writer, "typeLogData", "double")?;
    writer.write_event(Event::End(BytesEnd::new("logCurveInfo")))?;

    for (name, curve) in &las_data.curves {
        let log_curve_info = BytesStart::new("logCurveInfo")
            .with_attribute(("uid", name.as_str()));
        writer.write_event(Event::Start(log_curve_info))?;
        write_simple_element(&mut writer, "mnemonic", name)?;
        write_simple_element(&mut writer, "unit", &curve.unit)?;
        write_simple_element(&mut writer, "curveDescription", &curve.description)?;
        write_simple_element(&mut writer, "typeLogData", "double")?;
        writer.write_event(Event::End(BytesEnd::new("logCurveInfo")))?;
    }

    let log_data = BytesStart::new("logData");
    writer.write_event(Event::Start(log_data))?;

    let mnemonic_list = mnemonics.join(",");
    write_simple_element(&mut writer, "mnemonicList", &mnemonic_list)?;

    let unit_list = units.join(",");
    write_simple_element(&mut writer, "unitList", &unit_list)?;

    for i in 0..las_data.depth.len() {
        let mut data_row = format!("{:.2}", las_data.depth[i]);
        
        for name in &mnemonics[1..] {
            if let Some(curve) = las_data.curves.get(name) {
                if i < curve.data.len() {
                    data_row.push_str(&format!(",{:.4}", curve.data[i]));
                } else {
                    data_row.push_str(",");
                }
            } else {
                data_row.push_str(",");
            }
        }

        write_simple_element(&mut writer, "data", &data_row)?;
    }

    writer.write_event(Event::End(BytesEnd::new("logData")))?;
    writer.write_event(Event::End(BytesEnd::new("log")))?;

    write_formations_section(&mut writer, well_uid, well_name, formations)?;

    writer.write_event(Event::End(BytesEnd::new("logs")))?;

    Ok(String::from_utf8(buffer)?)
}

fn write_simple_element<W: std::io::Write>(
    writer: &mut Writer<W>,
    name: &str,
    value: &str,
) -> Result<()> {
    let elem = BytesStart::new(name);
    writer.write_event(Event::Start(elem))?;
    writer.write_event(Event::Text(value.into()))?;
    writer.write_event(Event::End(BytesEnd::new(name)))?;
    Ok(())
}

fn write_formations_section<W: std::io::Write>(
    writer: &mut Writer<W>,
    well_uid: &str,
    well_name: &str,
    formations: &Formations,
) -> Result<()> {
    let formation_marker = BytesStart::new("formationMarker")
        .with_attribute(("uidWell", well_uid))
        .with_attribute(("uidWellbore", well_uid))
        .with_attribute(("uid", format!("{}-formations", well_uid)));
    writer.write_event(Event::Start(formation_marker))?;

    write_simple_element(writer, "nameWell", well_name)?;
    write_simple_element(writer, "nameWellbore", &format!("{} Wellbore", well_name))?;
    write_simple_element(writer, "name", &format!("{} Formation Tops", well_name))?;

    for (idx, formation) in formations.formations.iter().enumerate() {
        let interval = BytesStart::new("interval")
            .with_attribute(("uid", format!("interval-{}", idx + 1)));
        writer.write_event(Event::Start(interval))?;

        write_simple_element(writer, "name", &formation.name)?;

        let md_top = BytesStart::new("mdTop")
            .with_attribute(("uom", "m"));
        writer.write_event(Event::Start(md_top))?;
        writer.write_event(Event::Text(format!("{:.2}", formation.top_depth).into()))?;
        writer.write_event(Event::End(BytesEnd::new("mdTop")))?;

        let md_bottom = BytesStart::new("mdBottom")
            .with_attribute(("uom", "m"));
        writer.write_event(Event::Start(md_bottom))?;
        writer.write_event(Event::Text(format!("{:.2}", formation.bottom_depth).into()))?;
        writer.write_event(Event::End(BytesEnd::new("mdBottom")))?;

        write_simple_element(writer, "lithology", &formation.lithology)?;

        writer.write_event(Event::End(BytesEnd::new("interval")))?;
    }

    writer.write_event(Event::End(BytesEnd::new("formationMarker")))?;

    Ok(())
}
