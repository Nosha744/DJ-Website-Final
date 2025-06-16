document.addEventListener('DOMContentLoaded', () => {
    const songRequestForm = document.getElementById('songRequestForm');
    const payAndRequestButton = document.getElementById('payAndRequestButton');
    
    const requestFormSection = document.getElementById('requestFormSection');
    const paymentSection = document.getElementById('paymentSection');
    const confirmationSection = document.getElementById('confirmationSection');

    const qrCodeContainer = document.getElementById('qrCodeContainer');
    const paymentStatusElement = document.getElementById('paymentStatus');
    const messageArea = document.getElementById('messageArea');
    const cancelPaymentButton = document.getElementById('cancelPaymentButton');
    
    const confirmationMessageElement = document.getElementById('confirmationMessage');
    const newRequestButton = document.getElementById('newRequestButton');
    const djModeLinksContainer = document.getElementById('djModeLinks');


    let currentInternalRefno = null;
    let pollingInterval = null;
    const POLLING_DELAY_MS = 3000;
    const POLLING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    // DJ Mode Link
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('djmode') === 'true' && djModeLinksContainer) {
        // Retrieve ADMIN_SECRET_KEY from a secure place if this was a real app.
        // For this demo, we'll assume the DJ knows to append it.
        // A more secure way would be server-side or a login.
        const adminKey = prompt("Enter Admin Key to enable DJ links (or it's in your .env):", "supersecretkey123");
        if (adminKey) {
            djModeLinksContainer.innerHTML = `
                <a href="/admin?key=${adminKey}" target="_blank">Admin Panel</a> |
                <a href="/queue" target="_blank">View Queue</a>
            `;
        }
    }


    songRequestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessage();
        const name = document.getElementById('name').value.trim();
        const songTitle = document.getElementById('songTitle').value.trim();

        if (!songTitle) {
            showMessage('Song title is required.', 'error');
            return;
        }

        setFormDisabled(true);
        payAndRequestButton.textContent = 'Processing...';

        try {
            const initResponse = await fetch('/api/initiate-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, songTitle })
            });
            const initData = await initResponse.json();

            if (!initResponse.ok) throw new Error(initData.error || `Error ${initResponse.status}`);

            currentInternalRefno = initData.internalRefno;
            qrCodeContainer.innerHTML = `<img src="data:image/png;base64,${initData.qrCodeData}" alt="TWINT QR Code">`;
            paymentStatusElement.textContent = 'Scan the QR code to pay CHF 1.00.';
            
            requestFormSection.style.display = 'none';
            paymentSection.style.display = 'block';
            confirmationSection.style.display = 'none';
            cancelPaymentButton.style.display = 'inline-block';
            
            startPollingPaymentStatus(currentInternalRefno);
        } catch (error) {
            console.error('Error initiating payment:', error);
            showMessage(`Error: ${error.message}`, 'error');
            resetToForm();
        }
    });

    cancelPaymentButton.addEventListener('click', () => {
        resetToForm();
        showMessage('Payment cancelled. You can try again.', 'info');
    });

    newRequestButton.addEventListener('click', () => {
        resetToForm();
    });

    function resetToForm() {
        stopPolling();
        currentInternalRefno = null;
        
        requestFormSection.style.display = 'block';
        paymentSection.style.display = 'none';
        confirmationSection.style.display = 'none';

        songRequestForm.reset();
        setFormDisabled(false);
        payAndRequestButton.textContent = 'Pay CHF 1.00 & Request';
        cancelPaymentButton.style.display = 'none';
        qrCodeContainer.innerHTML = '';
        clearMessage();
    }

    function setFormDisabled(isDisabled) {
        document.getElementById('name').disabled = isDisabled;
        document.getElementById('songTitle').disabled = isDisabled;
        payAndRequestButton.disabled = isDisabled;
    }
    
    function startPollingPaymentStatus(internalRefno) {
        stopPolling();
        let startTime = Date.now();
        paymentStatusElement.textContent = 'Waiting for payment confirmation...';

        pollingInterval = setInterval(async () => {
            if (Date.now() - startTime > POLLING_TIMEOUT_MS) {
                stopPolling();
                paymentStatusElement.textContent = 'Payment timed out.';
                showMessage('Payment timed out. If you paid, please contact the DJ. Otherwise, try again.', 'error');
                cancelPaymentButton.textContent = 'Try Again';
                return;
            }

            try {
                const statusResponse = await fetch(`/api/check-payment-status?internalRefno=${internalRefno}`);
                const statusData = await statusResponse.json();

                if (!statusResponse.ok) {
                    if (statusResponse.status === 400) { // Bad client request, stop polling
                        stopPolling();
                        showMessage(statusData.error || 'Error checking payment status. Try refreshing.', 'error');
                    }
                    paymentStatusElement.textContent = statusData.message || 'Checking status... (error)';
                    return;
                }
                
                paymentStatusElement.textContent = statusData.message || `Status: ${statusData.status}`;

                if (statusData.status === 'paid') {
                    stopPolling();
                    paymentStatusElement.textContent = 'Payment successful! Submitting request...';
                    await submitSongRequest(internalRefno);
                } else if (['failed', 'canceled', 'expired'].includes(statusData.status)) {
                    stopPolling();
                    showMessage(`Payment ${statusData.status}. Your song was not requested.`, 'error');
                    cancelPaymentButton.textContent = 'Try Again';
                }
            } catch (error) {
                console.error('Polling error:', error);
                paymentStatusElement.textContent = 'Error checking status. Retrying...';
            }
        }, POLLING_DELAY_MS);
    }

    function stopPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = null;
    }

    async function submitSongRequest(internalRefno) {
        try {
            const submitResponse = await fetch('/api/submit-song', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ internalRefno })
            });
            const submitData = await submitResponse.json();

            if (!submitResponse.ok) throw new Error(submitData.error || `Error ${submitResponse.status}`);
            
            // Show confirmation screen
            requestFormSection.style.display = 'none';
            paymentSection.style.display = 'none';
            confirmationSection.style.display = 'block';
            confirmationMessageElement.textContent = `Your request for "${submitData.request.songTitle}" has been submitted!`;
            clearMessage(); // Clear any previous error/info messages

        } catch (error) {
            console.error('Error submitting song:', error);
            // If submission fails after payment, it's a critical error
            showMessage(`Submission Error: ${error.message}. Payment was successful. Please inform the DJ about your request for "${document.getElementById('songTitle').value}".`, 'error');
            // Don't fully reset, allow DJ to see error and song title.
            // User can still use "Cancel / New Request" which becomes "Try Again" effectively.
            cancelPaymentButton.textContent = 'Start Over';
            cancelPaymentButton.style.display = 'inline-block'; // Ensure it's visible
        }
    }

    function showMessage(text, type = 'info') {
        messageArea.textContent = text;
        messageArea.className = `message-area message-${type}`;
    }
    function clearMessage() {
        messageArea.textContent = '';
        messageArea.className = 'message-area';
    }
});