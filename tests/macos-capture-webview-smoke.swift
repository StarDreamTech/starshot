// Native WebKit smoke test of the built capture UI, using only original pixels
// and mocked IPC. This does not test screen capture, AX access, or installation.
// Run from the repository root after `npm run build`:
//   mkdir -p artifacts/hover-detection
//   xcrun swiftc tests/macos-capture-webview-smoke.swift -o artifacts/hover-detection/macos-capture-webview-smoke
//   artifacts/hover-detection/macos-capture-webview-smoke dist > artifacts/hover-detection/macos-capture-webview-smoke.jsonl 2> artifacts/hover-detection/macos-capture-webview-smoke.stderr.log
// Each case opens the production index through tauri://, discovers hashed assets
// normally, and has a six-second deadline. No screenshot or clipboard API is used.
import AppKit
import WebKit

final class CaptureSmoke: NSObject, NSApplicationDelegate, WKURLSchemeHandler, WKScriptMessageHandler, WKNavigationDelegate {
    let root: URL
    let cases = ["startup-gate", "startup-failure", "module-worker", "worker-constructor-fallback", "worker-runtime-fallback", "native-element", "native-panel-path", "native-stale-tab", "worker-stale-tab", "interaction-reselect", "interaction-shortcuts"]
    var caseIndex = 0
    var view: WKWebView?
    var window: NSWindow?
    var timer: Timer?
    var deadline = Date()
    var evaluating = false
    var workerRequests = 0
    var failed = false
    var finished = false
    var currentCase: String { cases[caseIndex] }

    init(root: URL) { self.root = root; super.init() }
    func log(_ object: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), let line = String(data: data, encoding: .utf8) {
            print(line); fflush(stdout)
        }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 600), styleMask: [.titled], backing: .buffered, defer: false)
        window?.title = "Starshot — original fixture WebKit smoke test"
        // Assertions drive DOM events; live desktop pointer movement is unrelated input.
        window?.ignoresMouseEvents = true
        nextCase()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func nextCase() {
        workerRequests = 0; evaluating = false
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(self, forURLScheme: "tauri")
        config.userContentController.add(self, name: "probe")
        config.userContentController.addUserScript(WKUserScript(source: fixtureScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let next = WKWebView(frame: NSRect(x: 0, y: 0, width: 960, height: 600), configuration: config)
        next.navigationDelegate = self
        view?.configuration.userContentController.removeScriptMessageHandler(forName: "probe")
        view?.stopLoading(); view = next; window?.contentView = next
        log(["event": "case-start", "case": currentCase])
        next.load(URLRequest(url: URL(string: "tauri://localhost/index.html?view=capture")!))
        deadline = Date().addingTimeInterval(6)
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.poll() }
    }
    func fixtureScript() -> String {
        let scenario = String(data: try! JSONSerialization.data(withJSONObject: currentCase, options: [.fragmentsAllowed]), encoding: .utf8)!
        return """
        (() => {
          // WK tracking events can still arrive when NSWindow ignores mouse input.
          // Isolate the fixture from the live desktop, preserving all scripted events.
          for (const type of ['pointermove','pointerdown','pointerup','pointerover','pointerout','pointerenter','pointerleave','pointercancel','mousemove','mousedown','mouseup','mouseover','mouseout','mouseenter','mouseleave','click','dblclick','contextmenu','wheel','keydown','keyup']) {
            window.addEventListener(type, event => {
              if (!event.isTrusted) return;
              event.stopImmediatePropagation();
              if (event.cancelable) event.preventDefault();
            }, {capture:true,passive:false});
          }
          const scenario = \(scenario), state = { workerPosted: false, workerReply: false, fallback: false, requests: 0, resolved: 0, cycled: false, cycleAt: 0, pathStep: 0, errors: [], readyCalls: 0, readyError: '', readyCompleted: false, domDecoded: false, workers: 0, decodeGateChecked: false, acknowledgementGateChecked: false };
          const interaction = scenario.startsWith('interaction-');
          Object.assign(state, {cancelCalls:0,colorCalls:[],finishCalls:[],interactionStarted:false,phase:''});
          const panelPath = [
            {x:160,y:180,width:80,height:30,label:'模拟列表项'},
            {x:80,y:100,width:300,height:500,label:'导航面板'},
            {x:60,y:60,width:940,height:600,label:'内容区'},
            {x:40,y:40,width:1000,height:650,label:'模拟窗口'}
          ];
          const report = body => window.webkit.messageHandlers.probe.postMessage(body);
          window.addEventListener('error', event => { state.errors.push(event.message || 'window-error'); report({event:'window-error',message:event.message||'',file:event.filename||''}); });
          window.addEventListener('unhandledrejection', event => { state.errors.push(String(event.reason)); report({event:'unhandled-rejection',message:String(event.reason)}); });
          document.addEventListener('securitypolicyviolation', event => { state.errors.push('CSP '+event.effectiveDirective); report({event:'csp',directive:event.effectiveDirective,blocked:event.blockedURI}); });
          const decode = HTMLImageElement.prototype.decode;
          HTMLImageElement.prototype.decode = async function() {
            if (!this.classList.contains('capture-source')) return decode.call(this);
            if (scenario === 'startup-gate') {
              await new Promise(resolve => setTimeout(resolve, 180));
              if (state.readyCalls || state.requests || state.workers) state.errors.push('presentation or detection ran before displayed image decode');
              state.decodeGateChecked = true;
            }
            if (scenario === 'startup-failure') throw Error('fixture: displayed image decode failed');
            await decode.call(this); state.domDecoded = this.isConnected;
          };
          if (scenario.startsWith('startup-')) {
            window.requestAnimationFrame = () => 1;
            window.cancelAnimationFrame = () => {};
          }
          window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
            if (command === 'get_capture_frame') {
              const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 750;
              const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,1200,750);
              ctx.fillStyle = '#2c3448';
              if (scenario === 'native-panel-path') ctx.fillRect(70,90,320,520);
              else ctx.fillRect(120,140,240,160);
              if (interaction) state.fixtureCanvas = canvas;
              return {dataUrl:canvas.toDataURL('image/png'),width:1200,height:750,scaleFactor:1,pointer:{x:200,y:200},elementDetection:scenario.startsWith('native-')||scenario.startsWith('startup-'),regions:[{x:40,y:40,width:1000,height:650,label:'模拟窗口'}]};
            }
            if (command === 'capture_overlay_ready') {
              state.readyCalls++;
              if (args?.error) { state.readyError = args.error; return; }
              const image = document.querySelector('.capture-source');
              if (!state.domDecoded || !image?.isConnected || !image.complete || image.naturalWidth !== 1200 || document.querySelector('.capture-loading') || !document.querySelector('.capture-selection')) state.errors.push('native presentation ran before decoded image and committed UI');
              if (scenario === 'startup-gate') {
                await new Promise(resolve => setTimeout(resolve, 180));
                if (state.requests || state.workers) state.errors.push('detection ran before native presentation acknowledgement');
                state.acknowledgementGateChecked = true;
              }
              state.readyCompleted = true; return;
            }
            if (command === 'invalidate_capture_element') return;
            if (interaction && command === 'cancel_capture') { state.cancelCalls++; return; }
            if (interaction && command === 'copy_capture_color') {
              const {point,format} = args;
              if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y) || point.x < 0 || point.y < 0 || point.x >= 1200 || point.y >= 750 || !['hex','rgb'].includes(format)) throw Error('fixture: invalid color sample');
              // Sample the original fixture, never the magnifier or real clipboard.
              const rgb = [...state.fixtureCanvas.getContext('2d').getImageData(point.x,point.y,1,1).data].slice(0,3);
              const value = format === 'hex' ? '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase() : 'rgb('+rgb.join(', ')+')';
              state.colorCalls.push({point:{...point},format,value});
              if (state.failColor) { state.failColor = false; throw Error('fixture: stale capture'); }
              if (state.holdColor) await new Promise(resolve => { state.releaseColor = resolve; });
              return value;
            }
            if (interaction && command === 'finish_capture') {
              state.finishCalls.push(args);
              if (state.holdFinish) await new Promise(resolve => { state.releaseFinish = resolve; });
              return {completed:false};
            }
            if (command === 'get_capture_element') {
              if (!state.readyCompleted) state.errors.push('native query ran before presentation acknowledgement');
              state.requests++;
              if (args?.point?.x !== 200 || args?.point?.y !== 200) state.errors.push('initial pointer was not preserved');
              await new Promise(resolve => setTimeout(resolve, scenario === 'native-stale-tab' ? 400 : 10));
              state.resolved++;
              if (scenario === 'native-panel-path' || scenario === 'native-stale-tab') return [...panelPath, panelPath[1], panelPath[3]];
              return [{x:160,y:180,width:80,height:30,label:'模拟控件'}];
            }
            throw new Error('Unexpected IPC: '+command);
          }};
          const NativeWorker = window.Worker;
          if (scenario.startsWith('startup-')) {
            window.Worker = class { constructor(...args) { state.workers++; if (!state.readyCompleted) state.errors.push('worker ran before presentation acknowledgement'); return new NativeWorker(...args); } };
          } else if (scenario === 'worker-constructor-fallback') {
            window.Worker = class { constructor() { state.fallback = true; throw new Error('Intentional fixture constructor failure'); } };
          } else if (scenario === 'worker-runtime-fallback') {
            window.Worker = class { postMessage() { setTimeout(() => { state.fallback = true; this.onerror?.(new Event('error')); }, 10); } terminate() {} };
          } else if (scenario === 'worker-stale-tab' || scenario === 'native-panel-path') {
            window.Worker = class {
              constructor(...args) {
                this.worker = new NativeWorker(...args);
                this.worker.onmessage = event => {
                  const deliver = () => { state.workerReply = true; this.onmessage?.(event); };
                  if (scenario === 'native-panel-path') state.releaseWorker = deliver;
                  else setTimeout(deliver, 400);
                };
                this.worker.onerror = event => this.onerror?.(event);
              }
              postMessage(...args) { state.workerPosted = true; this.worker.postMessage(...args); }
              terminate() { this.worker.terminate(); }
            };
          }
          async function checkInteractions(stage) {
            const assert = (condition,message) => { if (!condition) throw Error(state.phase+': '+message); };
            const tick = () => new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const selected = () => document.querySelector('.capture-selection.is-selected');
            const visible = selector => { const node = document.querySelector(selector); return !!node && getComputedStyle(node).display !== 'none'; };
            const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
            const key = (key,options={},type='keydown') => window.dispatchEvent(new KeyboardEvent(type,{key,bubbles:true,cancelable:true,...options}));
            const shift = async () => { key('Shift'); key('Shift',{},'keyup'); await tick(); };
            // Synthetic pointer IDs cannot acquire OS pointer capture. Model only
            // that DOM contract; trusted desktop input remains blocked above.
            const captured = new Set();
            stage.setPointerCapture = id => captured.add(id);
            stage.hasPointerCapture = id => captured.has(id);
            stage.releasePointerCapture = id => captured.delete(id);
            const pointer = (type,x,y,options={}) => stage.dispatchEvent(new PointerEvent(type,{
              pointerId:21,pointerType:'mouse',isPrimary:true,bubbles:true,cancelable:true,button:0,
              buttons:type === 'pointerup' ? 0 : 1,
              clientX:x === 0 ? 0 : x === 1199 ? innerWidth-0.01 : (x+0.1)/1200*innerWidth,
              clientY:y === 0 ? 0 : y === 749 ? innerHeight-0.01 : (y+0.1)/750*innerHeight,...options
            }));
            const right = async () => { stage.dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true})); await tick(); };
            const drag = async (x,y,endX,endY) => { pointer('pointerdown',x,y); pointer('pointermove',endX,endY); await tick(); pointer('pointerup',endX,endY); await tick(); };
            const rect = () => {
              const style = selected()?.style;
              return style && {x:Math.round(parseFloat(style.left)*12),y:Math.round(parseFloat(style.top)*7.5),width:Math.round(parseFloat(style.width)*12),height:Math.round(parseFloat(style.height)*7.5)};
            };
            const originalImage = document.querySelector('.capture-source').src;
            state.phase = 'hints';
            const hint = document.querySelector('.capture-hint'), bounds = hint?.getBoundingClientRect();
            assert(hint && getComputedStyle(hint).pointerEvents === 'none','hint blocks pointer input');
            assert(bounds.left < 30 && innerHeight-bounds.bottom < 30,'hint is not at lower left');
            assert(hint.textContent.includes('右键') && hint.textContent.includes('Tab'),'selection hints missing');
            assert(text('.capture-magnifier').includes('复制颜色') && text('.capture-magnifier').includes('RGB/HEX'),'color hints missing');
            if (scenario === 'interaction-reselect') {
              state.phase = 'four corners';
              for (const [x,y,dx,dy] of [[0,0,40,40],[1199,0,-40,40],[0,749,40,-40],[1199,749,-40,-40]]) {
                await drag(x,y,x+dx,y+dy);
                const r = rect();
                assert(r && r.x === Math.min(x,x+dx) && r.y === Math.min(y,y+dy) && r.width === 41 && r.height === 41,'corner drag lost edge pixels');
                assert(!captured.size,'completed drag leaked pointer capture');
                await right();
                assert(!selected() && state.cancelCalls === 0,'right click ended capture instead of reselecting');
                assert(document.querySelector('.capture-source').src === originalImage,'reselection replaced frozen frame');
              }
              state.phase = 'cancel drag';
              pointer('pointerdown',100,100); pointer('pointermove',300,300); await tick();
              assert(selected() && captured.size === 1,'drag was not started');
              pointer('pointerup',300,300,{button:2,buttons:1});
              assert(captured.size === 1,'right release finished left drag');
              await right(); pointer('pointerup',300,300); await tick();
              assert(!selected() && !captured.size && !state.cancelCalls,'cancelled drag was resurrected by pointerup');
              state.phase = 'cancel annotation';
              await drag(100,100,500,500);
              document.querySelector('button[aria-label="矩形"]').click(); await tick();
              pointer('pointerdown',200,200); pointer('pointermove',300,300); await tick();
              assert(visible('.capture-edit-preview') && captured.size === 1,'annotation draft was not started');
              pointer('pointerup',300,300,{button:2,buttons:1});
              assert(captured.size === 1,'right release committed annotation draft');
              await right(); pointer('pointerup',300,300); await tick();
              assert(!selected() && !visible('.capture-edit-preview') && !captured.size && !state.cancelCalls,'cancelled annotation survived pointerup');
              await drag(100,100,500,500);
              assert(document.querySelector('button[aria-label="撤销"]').disabled,'cancelled draft entered undo history');
              state.phase = 'exit after reselect';
              await right(); assert(!selected() && !state.cancelCalls,'first right click did not reselect');
              await right(); assert(state.cancelCalls === 1,'second right click did not cancel exactly once');
            } else {
              state.phase = 'color failure and retry';
              assert(visible('.capture-magnifier') && text('.capture-color-value') === '#2C3448','initial color does not match original pixels');
              state.failColor = true; key('c'); await tick();
              assert(state.colorCalls.length === 1 && text('.capture-color-status').includes('fixture: stale capture'),'color error was not reported');
              assert(visible('.capture-magnifier') && !document.querySelector('[role=alert]') && !selected(),'failed color copy discarded capture UI');
              state.holdColor = true; key('c'); key('c'); key('c',{repeat:true}); await tick();
              assert(state.colorCalls.length === 2 && text('.capture-color-status').includes('正在复制'),'busy color copy was duplicated');
              state.phase = 'in-flight color snapshot';
              await shift(); pointer('pointermove',500,400,{buttons:0}); await tick();
              assert(text('.capture-color-value') === 'rgb(255, 255, 255)','Shift or pointer color update failed');
              state.holdColor = false; state.releaseColor(); await tick();
              const old = state.colorCalls[1];
              assert(old.point.x === 200 && old.point.y === 200 && old.format === 'hex' && old.value === '#2C3448','in-flight copy changed sampling point or format');
              assert(text('.capture-color-status').includes('#2C3448') && text('.capture-color-value') === 'rgb(255, 255, 255)','copy reply overwrote live color');
              key('c'); await tick();
              assert(state.colorCalls.length === 3 && state.colorCalls[2].format === 'rgb' && text('.capture-color-status').includes('rgb(255, 255, 255)'),'retry did not copy current RGB pixel');
              state.phase = 'Shift combination';
              key('Shift'); key('Tab',{shiftKey:true}); key('Shift',{},'keyup'); await tick();
              assert(text('.capture-color-value') === 'rgb(255, 255, 255)','Shift+Tab toggled color format');
              key('Shift'); pointer('pointermove',200,200,{buttons:0,shiftKey:true}); await tick(); key('Shift',{},'keyup'); await tick();
              assert(text('.capture-color-value') === 'rgb(44, 52, 72)','Shift plus movement toggled format');
              state.phase = 'fullscreen and Alt';
              key('a',{ctrlKey:true}); await tick();
              assert(JSON.stringify(rect()) === JSON.stringify({x:0,y:0,width:1200,height:750}),'Ctrl+A did not select full frame');
              assert(!visible('.capture-magnifier'),'selected magnifier should be hidden');
              key('c'); await tick(); assert(state.colorCalls.length === 3,'hidden magnifier copied color');
              key('Alt'); await tick(); assert(visible('.capture-magnifier'),'Alt did not show magnifier');
              await shift(); key('c'); await tick();
              assert(state.colorCalls.length === 4 && state.colorCalls[3].value === '#2C3448' && text('.capture-color-value') === '#2C3448','Alt color copy or HEX toggle failed');
              key('Alt',{},'keyup'); await tick(); assert(!visible('.capture-magnifier'),'Alt release did not hide magnifier');
              state.phase = 'pin and busy recovery';
              key('a',{metaKey:true}); await tick();
              state.holdFinish = true; key('t',{metaKey:true}); await tick();
              assert(state.finishCalls.length === 1 && state.finishCalls[0].action === 'pin' && JSON.stringify(state.finishCalls[0].rect) === JSON.stringify({x:0,y:0,width:1200,height:750}),'Cmd+A / Cmd+T did not pin full frame');
              key('t',{ctrlKey:true}); key('c'); await right();
              assert(state.finishCalls.length === 1 && state.colorCalls.length === 4 && !state.cancelCalls && selected(),'busy actions changed selection or duplicated IPC');
              state.holdFinish = false; state.releaseFinish(); await tick();
              assert(selected() && !document.querySelector('[role=alert]') && !document.querySelector('button[aria-label="贴到桌面"]').disabled,'cancelled completion did not preserve retryable UI');
              key('t',{ctrlKey:true}); await tick();
              assert(state.finishCalls.length === 2 && state.finishCalls[1].action === 'pin','Ctrl+T retry failed');
            }
            assert(!state.errors.length,'unexpected runtime errors');
            state.interactionResult = {result:'pass',phase:state.phase,cancelCalls:state.cancelCalls,colorCopies:state.colorCalls.length,pinRequests:state.finishCalls.length};
          }
          window.__captureSmoke = { sample() {
            const stage = document.querySelector('.capture-stage');
            const dimensions = document.querySelector('.capture-dimensions strong')?.textContent?.trim() || '';
            const label = document.querySelector('.capture-dimensions span')?.textContent?.trim() || '';
            const pointer = document.querySelector('.capture-magnifier small')?.textContent?.trim() || '';
            const error = document.querySelector('[role=alert]')?.textContent?.trim() || '';
            const snapshot = {dimensions,label,pointer,error,ready:!!stage&&!document.querySelector('.capture-loading'),requests:state.requests,resolved:state.resolved,readyCalls:state.readyCalls,domDecoded:state.domDecoded,decodeGateChecked:state.decodeGateChecked,acknowledgementGateChecked:state.acknowledgementGateChecked};
            if (scenario === 'startup-failure') {
              if (!state.readyError) return snapshot;
              const passed = state.readyCalls === 1 && state.readyError.includes('fixture: displayed image decode failed') && !state.readyCompleted && !state.domDecoded && !state.requests && !state.workers && !state.errors.length;
              return {...snapshot,result:passed?'pass':'fail',reason:passed?'':state.errors.join('; ')||'failed initialization was not reported without presentation/detection'};
            }
            if (state.errors.length || error) return {...snapshot,result:'fail',reason:state.errors.join('; ')||error};
            if (!stage) return snapshot;
            if (interaction) {
              if (!state.interactionStarted && state.readyCompleted && dimensions === '240 × 160') {
                state.interactionStarted = true;
                checkInteractions(stage).catch(cause => { state.interactionResult = {result:'fail',reason:String(cause),phase:state.phase}; });
              }
              return {...snapshot,phase:state.phase,...state.interactionResult};
            }
            if (scenario === 'native-panel-path') {
              if (!state.resolved) return snapshot;
              const path = [
                ['80 × 30','模拟列表项'], ['300 × 500','导航面板'], ['940 × 600','内容区'],
                ['1000 × 650','模拟窗口'], ['1200 × 750','整个画面'], ['1200 × 750','整个画面'],
                ['1000 × 650','模拟窗口'], ['940 × 600','内容区'], ['300 × 500','导航面板'],
                ['80 × 30','模拟列表项'], ['80 × 30','模拟列表项']
              ];
              const expected = path[state.pathStep];
              if (dimensions !== expected[0] || label !== expected[1] || pointer !== '200, 200') return {...snapshot,result:'fail',reason:'panel path step '+state.pathStep+' expected '+expected.join(' / ')};
              // Release a real pixel rectangle between panel and content only after
              // Tab has frozen the native path. It must not add an intermediate stop.
              if (state.pathStep === 1 && !state.workerReply) {
                if (state.releaseWorker) { state.releaseWorker(); state.releaseWorker = null; }
                return snapshot;
              }
              if (state.pathStep === path.length-1) return {...snapshot,result:'pass',pathSteps:path.length};
              const reverse = state.pathStep >= 5;
              if (reverse) window.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));
              window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:reverse,bubbles:true}));
              if (reverse) window.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));
              state.pathStep++; return snapshot;
            }
            if (scenario === 'native-stale-tab' && !state.cycled && state.requests && dimensions === '240 × 160') {
              window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})); state.cycled = true; state.cycleAt = performance.now(); return snapshot;
            }
            if (scenario === 'worker-stale-tab' && !state.cycled && state.workerPosted && !state.workerReply && dimensions === '1000 × 650') {
              window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})); state.cycled = true; state.cycleAt = performance.now(); return snapshot;
            }
            let expected = '240 × 160', complete = dimensions === expected;
            if (scenario === 'startup-gate') { expected = '80 × 30'; complete = dimensions === expected && state.resolved > 0 && state.decodeGateChecked && state.acknowledgementGateChecked && state.readyCompleted; }
            else if (scenario === 'native-element') { expected = '80 × 30'; complete = dimensions === expected && state.resolved > 0; }
            else if (scenario === 'native-stale-tab') { expected = '1000 × 650'; complete = state.cycled && state.resolved > 0 && performance.now()-state.cycleAt > 100; }
            else if (scenario === 'worker-stale-tab') { expected = '1200 × 750'; complete = state.cycled && state.workerReply && performance.now()-state.cycleAt > 100; }
            if (scenario.includes('fallback')) complete = complete && state.fallback;
            if (!complete) return snapshot;
            const passed = dimensions === expected && pointer === '200, 200';
            return {...snapshot,result:passed?'pass':'fail',reason:passed?'':'expected '+expected+' at pointer 200, 200'};
          }};
        })();
        """
    }
    func poll() {
        if finished { return }
        if Date() > deadline { finishCase(false, ["reason": "six-second deadline exceeded"]); return }
        if evaluating { return }
        guard let activeView = view else { return }
        evaluating = true
        let index = caseIndex
        activeView.evaluateJavaScript("window.__captureSmoke?.sample() ?? {ready:false}") { [weak self] value, error in
            guard let self, !self.finished, index == self.caseIndex else { return }
            self.evaluating = false
            if let error { self.finishCase(false, ["reason": String(describing: error)]); return }
            guard var snapshot = value as? [String: Any] else { return }
            if let result = snapshot["result"] as? String {
                let requiresWorker = !self.currentCase.contains("fallback") && self.currentCase != "startup-failure"
                let success = result == "pass" && (!requiresWorker || self.workerRequests > 0)
                if result == "pass" && !success { snapshot["reason"] = "production Worker was never requested through tauri scheme" }
                self.finishCase(success, snapshot)
            }
        }
    }
    func finishCase(_ success: Bool, _ snapshot: [String: Any]) {
        guard !finished else { return }
        timer?.invalidate(); timer = nil
        log(["event": "case-result", "case": currentCase, "result": success ? "pass" : "fail", "workerRequests": workerRequests, "state": snapshot])
        failed = failed || !success
        caseIndex += 1
        if caseIndex < cases.count { nextCase(); return }
        finished = true
        view?.stopLoading(); view?.configuration.userContentController.removeScriptMessageHandler(forName: "probe")
        window?.close()
        log(["event": "finished", "result": failed ? "fail" : "pass", "cases": cases.count])
        NSApp.stop(nil)
        if let event = NSEvent.otherEvent(with: .applicationDefined, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, subtype: 0, data1: 0, data2: 0) { NSApp.postEvent(event, atStart: true) }
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(NSError(domain: "CaptureSmoke", code: 400)); return }
        let path = url.path == "/" ? "/index.html" : url.path
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else { task.didFailWithError(NSError(domain: "CaptureSmoke", code: 404)); return }
        if webView === view, path.contains("capture-regions.worker"), path.hasSuffix(".js") {
            workerRequests += 1; log(["event": "worker-request", "case": currentCase, "path": path])
        }
        let mime = path.hasSuffix(".html") ? "text/html" : path.hasSuffix(".css") ? "text/css" : path.hasSuffix(".js") ? "text/javascript" : path.hasSuffix(".svg") ? "image/svg+xml" : "application/octet-stream"
        var headers = ["Content-Type": "\(mime); charset=utf-8", "Content-Length": "\(data.count)"]
        if path.hasSuffix(".html") {
            headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'; base-uri 'none'"
        }
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if webView === view { finishCase(false, ["reason": String(describing: error)]) } }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === view, let body = message.body as? [String: Any] else { return }
        log(["event": "page-log", "case": currentCase, "data": body])
    }
}

guard CommandLine.arguments.count == 2 else { fputs("Usage: macos-capture-webview-smoke /path/to/dist\n", stderr); exit(2) }
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
guard FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else { fputs("Missing dist/index.html; run npm run build first.\n", stderr); exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let smoke = CaptureSmoke(root: root)
app.delegate = smoke
app.run()
exit(smoke.failed ? 1 : 0)
