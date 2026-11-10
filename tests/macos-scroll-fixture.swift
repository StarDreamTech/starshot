import AppKit
import Darwin

final class PageView: NSView {
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill()
        dirtyRect.fill()
        for row in 0..<80 {
            let rect = NSRect(x: 16, y: row * 40 + 8, width: 260, height: 24)
            NSColor(calibratedRed: CGFloat(row % 7) / 8,
                    green: CGFloat(row % 11) / 12, blue: 0.6, alpha: 1).setFill()
            rect.fill()
        }
    }
}

func report(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 160, y: 180, width: 360, height: 400),
                      styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Starshot Original Scroll Fixture"
window.level = .floating
let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 360, height: 400))
scroll.hasVerticalScroller = true
scroll.hasHorizontalScroller = true
scroll.documentView = PageView(frame: NSRect(x: 0, y: 0, width: 3400, height: 3400))
window.contentView = scroll
scroll.contentView.postsBoundsChangedNotifications = true
let observer = NotificationCenter.default.addObserver(
    forName: NSView.boundsDidChangeNotification, object: scroll.contentView, queue: .main
) { _ in
    report(["offset": scroll.contentView.bounds.minY, "offsetX": scroll.contentView.bounds.minX])
}
window.orderFrontRegardless()
DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
    let frame = window.frame
    let top = NSScreen.screens.first!.frame.maxY
    report(["pid": getpid(), "x": frame.minX, "y": top - frame.maxY,
            "width": frame.width, "height": frame.height,
            "pointX": frame.midX, "pointY": top - frame.midY,
            "initialOffset": scroll.contentView.bounds.minY, "windowNumber": window.windowNumber])
}
application.run()
