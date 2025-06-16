document.addEventListener('DOMContentLoaded', () => {
    const upcomingSongsList = document.getElementById('upcomingSongsList');
    const playedSongsList = document.getElementById('playedSongsList');
    const refreshQueueButton = document.getElementById('refreshQueueButton');
    const autoRefreshToggleQueue = document.getElementById('autoRefreshToggleQueue');
    const queueMessageArea = document.getElementById('queueMessageArea');

    let autoRefreshInterval = null;
    const REFRESH_INTERVAL_MS = 10000; // Auto-refresh every 10 seconds

    async function fetchQueue() {
        try {
            const response = await fetch('/api/songs/queue');
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Error fetching queue: ${response.status}`);
            }
            const songs = await response.json();
            renderQueue(songs);
            showMessage('Queue updated.', 'info');
        } catch (error) {
            console.error('Error fetching queue:', error);
            showMessage(`Error: ${error.message}`, 'error');
        }
    }

    function renderQueue(songs) {
        upcomingSongsList.innerHTML = '';
        playedSongsList.innerHTML = '';

        const upcoming = songs.filter(s => !s.played);
        const played = songs.filter(s => s.played).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)); // Newest played first

        if (upcoming.length === 0) {
            upcomingSongsList.innerHTML = '<li>No songs currently in the queue. Be the first to request!</li>';
        } else {
            upcoming.forEach(song => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span class="song-title">${song.songTitle}</span>
                    <span class="requester-name">${song.name ? 'requested by ' + song.name : 'Anonymous request'}</span>
                `;
                upcomingSongsList.appendChild(li);
            });
        }

        if (played.length === 0) {
            playedSongsList.innerHTML = '<li>No songs played recently.</li>';
        } else {
            // Show limited number of played songs, e.g., last 5
            played.slice(0, 5).forEach(song => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span class="song-title">${song.songTitle}</span>
                    <span class="requester-name">${song.name ? 'by ' + song.name : ''}</span>
                `;
                playedSongsList.appendChild(li);
            });
        }
    }
    
    function setupAutoRefreshQueue() {
        if (autoRefreshToggleQueue.checked && !autoRefreshInterval) {
            autoRefreshInterval = setInterval(fetchQueue, REFRESH_INTERVAL_MS);
        } else if (!autoRefreshToggleQueue.checked && autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }

    function showMessage(text, type = 'info') {
        queueMessageArea.textContent = text;
        queueMessageArea.className = `message-area message-${type}`;
        setTimeout(() => {
            queueMessageArea.textContent = '';
            queueMessageArea.className = 'message-area';
        }, 3000);
    }

    // Initial Load & Event Listeners
    refreshQueueButton.addEventListener('click', fetchQueue);
    autoRefreshToggleQueue.addEventListener('change', setupAutoRefreshQueue);

    fetchQueue(); // Load queue on page load
    setupAutoRefreshQueue(); // Start auto-refresh if checked
});