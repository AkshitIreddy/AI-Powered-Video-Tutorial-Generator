fn main() {
    let icon_path = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo"),
    )
    .join("icons")
    .join("icon.ico");
    assert!(
        icon_path.is_file(),
        "the checked-in AI Video Tutorial Generator icon set is required"
    );

    // The context macro independently resolves the default window icon. Feed it
    // a build-scoped config overlay pointing at the same generated resource.
    let mut config: serde_json::Value = std::env::var("TAURI_CONFIG")
        .ok().map(|value| serde_json::from_str(&value).expect("valid Tauri config overlay"))
        .unwrap_or_else(|| serde_json::json!({}));
    if config.get("bundle").is_none() { config["bundle"] = serde_json::json!({}); }
    config["bundle"]["icon"] = serde_json::json!([icon_path.to_string_lossy()]);
    println!("cargo:rustc-env=TAURI_CONFIG={config}");

    let windows = tauri_build::WindowsAttributes::new().window_icon_path(icon_path);
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}
