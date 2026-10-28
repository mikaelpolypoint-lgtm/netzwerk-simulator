// Desktop-Hülle: zeigt dieselbe HTML-Datei wie die Web-Version in einem
// eigenen Fenster. Kein Netzwerkzugriff, keine Zusatzrechte; Speichern und
// Öffnen laufen wie im Browser über Download und Dateiauswahl.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Netzwerk-Simulator konnte nicht gestartet werden");
}
