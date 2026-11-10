#![cfg(all(feature = "desktop", target_os = "macos"))]

mod imaging {
    pub use starshot_lib::imaging::*;
}
mod scrolling {
    pub use starshot_lib::scrolling::*;
}
#[allow(dead_code)]
#[path = "../src/desktop/scroll_input.rs"]
mod scroll_input;
#[allow(dead_code, unused_imports)]
#[path = "../src/window_regions.rs"]
mod window_regions;

use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

struct Fixture(Child);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore]
fn targeted_scroll_moves_only_original_fixture_without_capture() {
    let executable = std::env::var_os("STARSHOT_SCROLL_FIXTURE")
        .expect("set STARSHOT_SCROLL_FIXTURE to the compiled tests/macos-scroll-fixture.swift");
    let mut fixture = Fixture(
        Command::new(executable)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("start original scroll fixture"),
    );
    let stdout = fixture.0.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                let _ = sender.send(value);
            }
        }
    });
    let ready = loop {
        let value = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("fixture ready");
        if value["pid"].is_number() {
            break value;
        }
    };
    assert_eq!(ready["pid"].as_u64().unwrap(), u64::from(fixture.0.id()));
    eprintln!("fixture readiness: {ready}");
    let target = window_regions::snapshot(std::process::id())
        .unwrap()
        .into_iter()
        .find(|window| window.pid == fixture.0.id())
        .expect("original fixture geometry");
    let point = (
        ready["pointX"].as_f64().unwrap() as i32,
        ready["pointY"].as_f64().unwrap() as i32,
    );
    let reverse = std::env::var("STARSHOT_SCROLL_REVERSE").as_deref() == Ok("1");
    for (direction, field) in [
        (scrolling::ScrollDirection::Vertical, "offset"),
        (scrolling::ScrollDirection::Horizontal, "offsetX"),
    ] {
        scroll_input::scroll_down(target, point, 100, direction, reverse)
            .expect("post scroll to owned fixture");
        loop {
            let value = receiver
                .recv_timeout(Duration::from_secs(5))
                .expect("fixture scroll response");
            eprintln!("fixture response: {value}");
            if value[field].as_f64().unwrap_or(0.0) > 0.0 {
                break;
            }
        }
    }
}
