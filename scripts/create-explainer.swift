import AppKit
import AVFoundation
import CoreVideo

let width = 1280
let height = 720
let fps: Int32 = 24
let sceneDuration = 3.0

struct Scene {
    let imagePath: String
    let title: String
    let subtitle: String
}

let root = FileManager.default.currentDirectoryPath
let scenes = [
    Scene(
        imagePath: "\(root)/apps/web/assets/images/loanos-msme-manufacturing.jpg",
        title: "A business has an ambition.",
        subtitle: "A machine. A larger order. A stronger tomorrow."
    ),
    Scene(
        imagePath: "\(root)/apps/web/assets/images/loanos-people-and-platform.jpg",
        title: "A lender sees the whole story.",
        subtitle: "Purpose, identity, cash flow and documents stay connected."
    ),
    Scene(
        imagePath: "\(root)/apps/web/assets/images/loanos-lending-team.jpg",
        title: "People decide. Evidence follows.",
        subtitle: "Policy and AI can assist. Accountable people remain in command."
    ),
    Scene(
        imagePath: "\(root)/apps/web/assets/images/loanos-people-and-platform.jpg",
        title: "The loan stays clear after disbursement.",
        subtitle: "Repayments, service, conversations and closure keep the same context."
    ),
    Scene(
        imagePath: "\(root)/apps/web/assets/images/loanos-lending-team.jpg",
        title: "One ambition. One clear journey.",
        subtitle: "LoanOS India — the lending operating system."
    )
]

let images: [NSImage] = scenes.map { scene in
    guard let image = NSImage(contentsOfFile: scene.imagePath) else {
        fatalError("Could not load \(scene.imagePath)")
    }
    return image
}

let outputPath = "\(root)/apps/web/assets/video/loanos-one-journey.mp4"
let outputURL = URL(fileURLWithPath: outputPath)
try? FileManager.default.removeItem(at: outputURL)

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 4_500_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
    ]
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height
    ]
)

guard writer.canAdd(input) else { fatalError("Could not add video input") }
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "Could not start writer") }
writer.startSession(atSourceTime: .zero)

func ease(_ value: CGFloat) -> CGFloat {
    let clamped = min(max(value, 0), 1)
    return clamped * clamped * (3 - 2 * clamped)
}

func drawImage(_ image: NSImage, in context: CGContext, progress: CGFloat, fraction: CGFloat, direction: CGFloat) {
    let canvas = CGSize(width: width, height: height)
    let source = image.size
    let cover = max(canvas.width / source.width, canvas.height / source.height)
    let zoom = 1.03 + (0.055 * progress)
    let drawSize = CGSize(width: source.width * cover * zoom, height: source.height * cover * zoom)
    let travel: CGFloat = 34
    let x = (canvas.width - drawSize.width) / 2 + ((progress - 0.5) * travel * direction)
    let y = (canvas.height - drawSize.height) / 2
    image.draw(
        in: NSRect(x: x, y: y, width: drawSize.width, height: drawSize.height),
        from: .zero,
        operation: .sourceOver,
        fraction: fraction,
        respectFlipped: true,
        hints: [.interpolation: NSImageInterpolation.high]
    )
}

func drawText(scene: Scene, in context: CGContext, opacity: CGFloat, isFinal: Bool) {
    let dark = NSColor(calibratedRed: 8/255, green: 43/255, blue: 35/255, alpha: 0.72 * opacity)
    dark.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: 720, height: height)).fill()
    NSColor(calibratedWhite: 0, alpha: 0.12 * opacity).setFill()
    NSBezierPath(rect: NSRect(x: 720, y: 0, width: width - 720, height: height)).fill()

    let lime = NSColor(calibratedRed: 223/255, green: 242/255, blue: 118/255, alpha: opacity)
    let white = NSColor(calibratedWhite: 1, alpha: opacity)
    let softWhite = NSColor(calibratedWhite: 1, alpha: 0.76 * opacity)
    let serif = NSFont(name: "Georgia", size: isFinal ? 74 : 65) ?? NSFont.systemFont(ofSize: 65, weight: .regular)
    let sans = NSFont.systemFont(ofSize: 24, weight: .regular)
    let labelFont = NSFont.systemFont(ofSize: 15, weight: .bold)

    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = -2
    let title = NSAttributedString(string: scene.title, attributes: [
        .font: serif,
        .foregroundColor: white,
        .paragraphStyle: paragraph
    ])
    let subtitle = NSAttributedString(string: scene.subtitle, attributes: [
        .font: sans,
        .foregroundColor: softWhite
    ])
    let label = NSAttributedString(string: isFinal ? "LENDING, MADE CLEAR" : "ONE LENDING JOURNEY", attributes: [
        .font: labelFont,
        .foregroundColor: lime,
        .kern: 2.0
    ])

    label.draw(in: NSRect(x: 74, y: 174, width: 560, height: 30))
    title.draw(with: NSRect(x: 72, y: 220, width: 590, height: 190), options: [.usesLineFragmentOrigin, .usesFontLeading])
    subtitle.draw(with: NSRect(x: 75, y: 430, width: 560, height: 90), options: [.usesLineFragmentOrigin, .usesFontLeading])

    lime.setFill()
    let mark = NSBezierPath(roundedRect: NSRect(x: 74, y: 614, width: 38, height: 38), xRadius: 14, yRadius: 14)
    mark.fill()
    let markText = NSAttributedString(string: "L", attributes: [
        .font: NSFont(name: "Georgia", size: 23) ?? NSFont.systemFont(ofSize: 23),
        .foregroundColor: NSColor(calibratedRed: 8/255, green: 43/255, blue: 35/255, alpha: opacity)
    ])
    markText.draw(at: NSPoint(x: 86, y: 620))
    let brand = NSAttributedString(string: "LoanOS India", attributes: [
        .font: NSFont.systemFont(ofSize: 17, weight: .bold),
        .foregroundColor: white
    ])
    brand.draw(at: NSPoint(x: 124, y: 623))
}

func makePixelBuffer() -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool,
          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
          let buffer else { fatalError("Could not create pixel buffer") }
    return buffer
}

let totalFrames = Int(Double(scenes.count) * sceneDuration * Double(fps))
for frameIndex in 0..<totalFrames {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
    autoreleasepool {
        let seconds = Double(frameIndex) / Double(fps)
        let sceneIndex = min(Int(seconds / sceneDuration), scenes.count - 1)
        let local = seconds - Double(sceneIndex) * sceneDuration
        let progress = CGFloat(local / sceneDuration)
        let buffer = makePixelBuffer()
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else { fatalError("Missing buffer memory") }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
        guard let cg = CGContext(data: baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: bitmapInfo) else { fatalError("Could not create context") }
        cg.setFillColor(NSColor.black.cgColor)
        cg.fill(CGRect(x: 0, y: 0, width: width, height: height))
        cg.translateBy(x: 0, y: CGFloat(height))
        cg.scaleBy(x: 1, y: -1)

        let graphics = NSGraphicsContext(cgContext: cg, flipped: true)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = graphics
        cg.saveGState()
        cg.clip(to: CGRect(x: 0, y: 0, width: width, height: height))
        drawImage(images[sceneIndex], in: cg, progress: progress, fraction: 1, direction: sceneIndex.isMultiple(of: 2) ? 1 : -1)
        let transitionStart = 2.55
        if local > transitionStart && sceneIndex < scenes.count - 1 {
            let blend = ease(CGFloat((local - transitionStart) / (sceneDuration - transitionStart)))
            drawImage(images[sceneIndex + 1], in: cg, progress: 0, fraction: blend, direction: (sceneIndex + 1).isMultiple(of: 2) ? 1 : -1)
        }
        cg.restoreGState()
        let fadeIn = ease(CGFloat(local / 0.45))
        let fadeOut = sceneIndex == scenes.count - 1 ? 1 : ease(CGFloat((sceneDuration - local) / 0.48))
        drawText(scene: scenes[sceneIndex], in: cg, opacity: min(fadeIn, fadeOut), isFinal: sceneIndex == scenes.count - 1)
        NSGraphicsContext.restoreGraphicsState()

        let time = CMTime(value: CMTimeValue(frameIndex), timescale: fps)
        guard adaptor.append(buffer, withPresentationTime: time) else {
            fatalError(writer.error?.localizedDescription ?? "Could not append frame")
        }
    }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
if writer.status != .completed {
    fatalError(writer.error?.localizedDescription ?? "Video writer did not complete")
}
print(outputPath)
