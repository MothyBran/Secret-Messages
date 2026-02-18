// public/assets/js/ui.js
// Unified UI Logic for Toasts, Modals, Loaders, and Window Management

(function(window) {
    // --- WINDOW MANAGER (Dynamic Z-Index) ---
    const WindowManager = {
        baseZIndex: 2000,
        currentMaxZIndex: 2000,

        bringToFront: function(elementOrId) {
            let el = (typeof elementOrId === 'string') ? document.getElementById(elementOrId) : elementOrId;
            if (!el) return;

            this.currentMaxZIndex++;
            el.style.zIndex = this.currentMaxZIndex;

            // Ensure overlay (if exists) is just below the modal/sidebar
            // Note: Our CSS uses shared overlays for sidebars, but modals have their own backdrop usually
            // or the modal container itself is the backdrop.
            // If the element has a class 'modal', it usually includes the backdrop.
        }
    };

    window.WindowManager = WindowManager;

    // Helper to attach click listeners to all potential windows
    window.initWindowManager = function() {
        // Attach to all existing .modal and .sidebar elements
        const windows = document.querySelectorAll('.modal, .sidebar, #contactSidebar, #inboxSidebar');
        windows.forEach(el => {
            el.addEventListener('mousedown', () => WindowManager.bringToFront(el));
            el.addEventListener('touchstart', () => WindowManager.bringToFront(el));
        });
    };

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.initWindowManager);
    } else {
        window.initWindowManager();
    }


    // --- TOAST NOTIFICATIONS ---
    window.showToast = function(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '❌';

        toast.innerHTML = `<span style="font-size:1.2rem;">${icon}</span><span>${message}</span>`;
        container.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto remove
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    };

    // --- MESSAGE MODAL ---
    window.showMessage = function(title, message, callback = null, buttonText = "OK") {
        let modal = document.getElementById('messageModal');

        // Dynamic creation if missing
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'messageModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-box">
                    <h3 id="msgModalTitle">Info</h3>
                    <p id="msgModalText"></p>
                    <div class="modal-actions">
                        <button id="msgModalBtn" class="modal-btn primary">OK</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            // Attach WindowManager
            modal.addEventListener('mousedown', () => WindowManager.bringToFront(modal));
            modal.addEventListener('touchstart', () => WindowManager.bringToFront(modal));
        }

        const titleEl = document.getElementById('msgModalTitle') || modal.querySelector('h3');
        const textEl = document.getElementById('msgModalText') || modal.querySelector('p');
        const btn = document.getElementById('msgModalBtn') || modal.querySelector('button');

        if(titleEl) titleEl.textContent = title;
        if(textEl) textEl.innerHTML = message.replace(/\n/g, '<br>');
        if(btn) btn.textContent = buttonText;

        // Handler
        const closeHandler = () => {
            modal.classList.remove('active');
            if(modal.style.display) modal.style.display = 'none'; // support old style
            if (callback) callback();
        };

        if(btn) btn.onclick = closeHandler;

        WindowManager.bringToFront(modal);
        modal.classList.add('active');
        if(modal.style.display === 'none') modal.style.display = 'flex';
    };

    // --- CONFIRM MODAL ---
    window.showConfirm = function(message, onConfirm, options = {}) {
        let modal = document.getElementById('confirmModal'); // Often '#appConfirmModal' in index.html, '#confirmModal' in admin

        // Fallback for ID differences (unification)
        if (!modal) modal = document.getElementById('appConfirmModal');

        if (!modal) {
            // Create if missing
            modal = document.createElement('div');
            modal.id = 'confirmModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-box">
                    <h3 id="confirmModalTitle">Bestätigen</h3>
                    <p id="confirmModalText"></p>
                    <div class="modal-actions">
                        <button id="confirmModalBtnNo" class="modal-btn">Nein</button>
                        <button id="confirmModalBtnYes" class="modal-btn primary">Ja</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            // Attach WindowManager
            modal.addEventListener('mousedown', () => WindowManager.bringToFront(modal));
            modal.addEventListener('touchstart', () => WindowManager.bringToFront(modal));
        }

        const titleEl = document.getElementById('confirmModalTitle') || document.getElementById('appConfirmTitle') || modal.querySelector('h3');
        const textEl = document.getElementById('confirmModalText') || document.getElementById('appConfirmMessage') || modal.querySelector('p'); // check specific IDs first
        const btnYes = document.getElementById('confirmModalBtnYes') || document.getElementById('btnConfirmYes') || document.getElementById('btnAppConfirmYes');
        const btnNo = document.getElementById('confirmModalBtnNo') || document.getElementById('btnConfirmNo') || document.getElementById('btnAppConfirmNo');

        if (titleEl) titleEl.textContent = options.title || 'Bestätigen';
        if (textEl) textEl.textContent = message;
        if (btnYes) btnYes.textContent = options.confirm || 'Ja';
        if (btnNo) btnNo.textContent = options.cancel || 'Nein';

        // Checkbox logic (Admin style)
        const checkboxContainer = document.getElementById('confirmCheckboxArea');
        let checkbox = null;
        if (checkboxContainer) {
            if (options.checkboxLabel) {
                checkboxContainer.style.display = 'flex';
                document.getElementById('confirmCheckboxLabel').textContent = options.checkboxLabel;
                checkbox = document.getElementById('confirmCascadeCheckbox');
                if(checkbox) checkbox.checked = false;
            } else {
                checkboxContainer.style.display = 'none';
            }
        }

        WindowManager.bringToFront(modal);
        modal.classList.add('active');
        if(modal.style.display === 'none') modal.style.display = 'flex';

        // Event Handlers
        const close = () => {
            modal.classList.remove('active');
            if(modal.style.display) modal.style.display = 'none';
        };

        if(btnYes) {
            btnYes.onclick = () => {
                close();
                // Pass checkbox state if applicable
                const checked = checkbox ? checkbox.checked : false;
                onConfirm(checked);
            };
        }

        if(btnNo) {
            btnNo.onclick = close;
        }
    };

    // --- LOADER ---
    window.showLoader = function(text = "Verarbeite Daten...") {
        let loader = document.getElementById('global-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'global-loader';
            loader.innerHTML = `
                <div class="loader-spinner-large"></div>
                <div class="loader-text">${text}</div>
            `;
            document.body.appendChild(loader);
        }
        const textEl = loader.querySelector('.loader-text');
        if (textEl) textEl.textContent = text;

        loader.classList.add('active');
    };

    window.hideLoader = function() {
        const loader = document.getElementById('global-loader');
        if (loader) loader.classList.remove('active');
    };

})(window);
