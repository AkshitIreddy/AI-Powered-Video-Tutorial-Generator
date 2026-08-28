use std::path::PathBuf;

fn main() {
    // Windows resource compilation requires an ICO even during `cargo check`.
    // Keep this deterministic build-only placeholder until the release artwork
    // pipeline supplies the signed icon set; no generated binary is tracked.
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    let icon_path = output.join("alystria-build-placeholder.ico");
    std::fs::write(&icon_path, placeholder_ico()).expect("write build icon");

    // The context macro independently resolves the default window icon. Feed it
    // a build-scoped config overlay pointing at the same generated resource.
    let escaped_icon_path = icon_path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    println!("cargo:rustc-env=TAURI_CONFIG={{\"bundle\":{{\"icon\":[\"{escaped_icon_path}\"]}}}}");

    let windows = tauri_build::WindowsAttributes::new().window_icon_path(icon_path);
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}

fn placeholder_ico() -> Vec<u8> {
    let mut bytes = vec![
        0, 0, 1, 0, 1, 0, // ICONDIR
        1, 1, 0, 0, 1, 0, 32, 0, 48, 0, 0, 0, 22, 0, 0, 0, // entry
        40, 0, 0, 0, // BITMAPINFOHEADER size
        1, 0, 0, 0, // width
        2, 0, 0, 0, // doubled height (colour + mask)
        1, 0, 32, 0, // planes and bits per pixel
        0, 0, 0, 0, // BI_RGB
        4, 0, 0, 0, // colour image bytes
        0, 0, 0, 0, 0, 0, 0, 0, // pixels per metre
        0, 0, 0, 0, 0, 0, 0, 0, // palette
    ];
    bytes.extend_from_slice(&[0xE8, 0x58, 0x56, 0xFF]); // Studio Indigo BGRA
    bytes.extend_from_slice(&[0, 0, 0, 0]); // transparent-mask row
    bytes
}
