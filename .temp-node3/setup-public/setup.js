const nodeNameInput = document.getElementById('nodeName');
const nameStatus = document.getElementById('name-status');
const submitBtn = document.querySelector('button[type="submit"]');

let debounceTimer = null;
let nameIsValid = false; // tracks whether the current name passed the check

function setStatus(state, text) {
    nameStatus.className = `name-status ${state}`;
    nameStatus.textContent = text;
}

function resetStatus() {
    nameStatus.className = 'name-status';
    nameStatus.textContent = '';
    nameIsValid = false;
    submitBtn.disabled = false;
}

async function checkName(name) {
    if (!name) { resetStatus(); return; }

    setStatus('checking', 'Checking availability...');
    submitBtn.disabled = true;
    nameIsValid = false;

    try {
        const res = await fetch(`/api/check-name?name=${encodeURIComponent(name)}`);
        const data = await res.json();

        if (data.available && !data.warning) {
            setStatus('available', 'Name is available');
            nameIsValid = true;
            submitBtn.disabled = false;
        } else if (data.available && data.warning) {
            setStatus('warning', `⚠ ${data.warning}`);
            nameIsValid = true;    // allow through with a warning
            submitBtn.disabled = false;
        } else {
            setStatus('taken', '✗ Name is already reserved by another node');
            nameIsValid = false;
            submitBtn.disabled = true;
        }
    } catch (err) {
        setStatus('warning', '⚠ Could not verify name – proceeding anyway');
        nameIsValid = true;
        submitBtn.disabled = false;
    }
}

// Debounce: fire 500ms after the user stops typing
nodeNameInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = nodeNameInput.value.trim();
    if (!val) { resetStatus(); return; }
    setStatus('checking', '⏳ Checking availability...');
    debounceTimer = setTimeout(() => checkName(val), 500);
});

// Guard on form submit too (in case they paste and immediately click)
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nodeType = document.getElementById('nodeType').value;
    const nodeName = nodeNameInput.value.trim();
    const adminUser = document.getElementById('adminUser').value;
    const adminPass = document.getElementById('adminPass').value;

    // Final check if the user somehow bypassed the debounce
    if (!nameIsValid) {
        await checkName(nodeName);
        if (!nameIsValid) return; // blocked — status already shown
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Installing...';

    fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeType, nodeName, adminUser, adminPass })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                setStatus('available', '✓ Setup complete — redirecting...');
                setTimeout(() => { window.location.href = '/'; }, 2000);
            } else {
                setStatus('taken', '✗ Setup failed: ' + data.error);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Install Node';
            }
        })
        .catch(err => {
            setStatus('taken', '✗ Network error during setup.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Install Node';
            console.error(err);
        });
});
