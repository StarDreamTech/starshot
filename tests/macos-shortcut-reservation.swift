// Original native shortcut-conflict fixture. No screenshots or clipboard access.
// Build: xcrun swiftc tests/macos-shortcut-reservation.swift -o /tmp/starshot-shortcut-reservation
// Run with stdin open; press Return (or close stdin) to release and exit.
// Pass --exclusive to reserve with kEventHotKeyExclusive, matching global-hotkey.
// Only Control+Alt+Shift+F8 is reserved; no key events are read or generated.
import AppKit
import Carbon
import Darwin

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let exclusive = CommandLine.arguments.contains("--exclusive")
var hotKey: EventHotKeyRef?
let status = RegisterEventHotKey(
    UInt32(kVK_F8), UInt32(controlKey | optionKey | shiftKey),
    EventHotKeyID(signature: 0x53535453, id: 1),
    GetApplicationEventTarget(), exclusive ? UInt32(kEventHotKeyExclusive) : 0, &hotKey
)
print("{\"shortcut\":\"Control+Alt+Shift+F8\",\"exclusive\":\(exclusive),\"registered\":\(status == noErr),\"osStatus\":\(status)}")
fflush(stdout)
guard status == noErr, let hotKey else { exit(1) }

DispatchQueue.global().async {
    _ = readLine()
    DispatchQueue.main.async {
        let releaseStatus = UnregisterEventHotKey(hotKey)
        print("{\"released\":\(releaseStatus == noErr),\"osStatus\":\(releaseStatus)}")
        fflush(stdout)
        exit(releaseStatus == noErr ? 0 : 1)
    }
}
app.run()
