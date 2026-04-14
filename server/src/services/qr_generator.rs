use anyhow::Result;
use base64::{engine::general_purpose, Engine};
use image::Luma;
use qrcode::QrCode;

/// Generate a QR code as a base64-encoded PNG data URI.
/// The QR encodes a URL like `https://yourdomain.com/pay/NCH23`.
pub fn generate_qr_base64(vehicle_short_id: &str, base_url: &str) -> Result<String> {
    let url = format!("{}/{}", base_url, vehicle_short_id);
    let code = QrCode::new(url.as_bytes())?;

    let image = code.render::<Luma<u8>>().min_dimensions(200, 200).build();

    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    image.write_to(&mut cursor, image::ImageFormat::Png)?;

    let encoded = general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", encoded))
}
