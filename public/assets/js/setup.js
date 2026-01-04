document.addEventListener('DOMContentLoaded', () => {
    const setupForm = document.getElementById('setupForm');
    if (setupForm) {
        setupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const key = document.getElementById('masterKey').value;
            const user = document.getElementById('username').value;
            const pass = document.getElementById('password').value;
            const msg = document.getElementById('msg');

            // UI Elements
            const loader = document.getElementById('loader');
            const successView = document.getElementById('successView');
            const form = document.getElementById('setupForm');

            // 1. UI Reset & Start
            msg.textContent = "";
            form.style.display = 'none'; // Hide inputs
            if(loader) loader.classList.add('active'); // Show Spinner

            try {
                const res = await fetch('/api/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ masterKey: key, username: user, password: pass })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    // 2. Success State
                    if(loader) loader.classList.remove('active');
                    if(successView) successView.classList.add('active');

                    // Redirect after delay
                    setTimeout(() => window.location.href = '/login-enterprise.html', 2000);
                } else {
                    throw new Error(data.error || "Unbekannt");
                }
            } catch (err) {
                // Restore UI on Error
                if(loader) loader.classList.remove('active');
                form.style.display = 'block';
                msg.style.color = "#ff3333";
                msg.textContent = "Fehler: " + (err.message || "Server nicht erreichbar");
            }
        });
    }
});
