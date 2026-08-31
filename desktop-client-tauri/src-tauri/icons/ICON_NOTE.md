// Placeholder Tauri icon. Real builds require multiple PNG/ICO files under
// desktop-client-tauri/src-tauri/icons/. For now we copy the SVG from the
// web client (it is the same brand mark) and a generated PNG stub so the
// Tauri configuration can be loaded without a missing-file error. Replace
// with the real icon set before the v3.13 release.
#![allow(dead_code)]
pub const ICON_NOTE: &str = "Tauri icons need to be generated via `tauri icon` before the v3.13 release. See scripts/build-deb-client.sh for the SVG asset to convert.";
