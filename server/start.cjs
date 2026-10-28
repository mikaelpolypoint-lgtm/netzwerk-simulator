'use strict';
// Startdatei der Webversion (in Plesk als «Anwendungsstartdatei» eintragen).
// Siehe docs/plesk.md. Phusion Passenger fängt listen() ab; der Port ist dann egal.
const { createServer, ADMIN_PASSWORD } = require('./app.cjs');

const port = Number(process.env.PORT) || 3000;
createServer().listen(port, () => {
  console.log(`Netzwerk-Simulator läuft auf Port ${port}${ADMIN_PASSWORD ? '' : ' (Admin gesperrt: ADMIN_PASSWORD fehlt)'}`);
});
