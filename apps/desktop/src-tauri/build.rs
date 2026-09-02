fn main() {
    let icon_path = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo"),
    )
    .join("icons")
    .join("icon.ico");
    assert!(
        icon_path.is_file(),
        "the checked-in Alystria icon set is required"
    );

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
