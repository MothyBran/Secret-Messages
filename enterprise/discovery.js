// enterprise/discovery.js
const { Bonjour } = require('bonjour-service');

let bonjour;

module.exports = {
    start: (port) => {
        try {
            bonjour = new Bonjour();

            // Broadcast the service
            // Type: _sm-msg-hub._tcp
            // Name: secure-msg.local
            bonjour.publish({
                name: 'Secure Messages Hub',
                type: 'sm-msg-hub',
                port: port,
                txt: { version: '2.0.0', type: 'enterprise-hub' }
            });

            console.log(`📡 Enterprise Hub Broadcasting on port ${port} (mDNS: _sm-msg-hub._tcp)`);

        } catch (e) {
            console.error("Bonjour Discovery Error:", e);
        }
    },
    stop: () => {
        if (bonjour) {
            bonjour.unpublishAll();
            bonjour.destroy();
        }
    }
};
