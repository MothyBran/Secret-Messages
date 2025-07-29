// store.js

const licenseMapping = {
  "1m": { name: "1 Monat Zugang", price: "1,99 €" },
  "3m": { name: "3 Monate Zugang", price: "4,49 €" },
  "12m": { name: "12 Monate Zugang", price: "14,99 €" },
  "unlimited": { name: "Unbegrenzter Zugang", price: "49,99 €" },
  "bundle_1m_2": { name: "2× 1 Monat Zugang", price: "3,79 €" },
  "bundle_3m_2": { name: "2× 3 Monate Zugang", price: "7,99 €" },
  "bundle_3m_5": { name: "5× 3 Monate Zugang", price: "19,99 €" },
  "bundle_1y_10": { name: "10× 12 Monate Zugang", price: "129,99 €" }
};

document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".license-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const plan = btn.getAttribute("onclick").match(/buyLicense\('(.+?)'\)/)[1];
      showModal(plan);
    });
  });
});

function showModal(plan) {
  const modal = document.getElementById("modalOverlay");
  const planText = document.getElementById("modalPlan");
  const priceText = document.getElementById("modalPrice");

  const license = licenseMapping[plan];
  if (!license) {
    alert("Unbekannter Lizenztyp.");
    return;
  }

  modal.dataset.selectedPlan = plan;
  planText.textContent = `🔐 Lizenz: ${license.name}`;
  priceText.textContent = `💶 Preis: ${license.price}`;
  modal.style.display = "block";
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
}

function confirmPurchase() {
  const plan = document.getElementById("modalOverlay").dataset.selectedPlan;
  closeModal();

  // TODO: Hier kannst du zur Zahlungsseite weiterleiten
  alert(`💳 Weiterleitung zur Bezahlung für Plan: ${plan}\n(Funktion noch nicht angebunden)`);
}
