document.addEventListener('DOMContentLoaded', () => {
    const requestsTableBody = document.querySelector('#requestsTable tbody');
    const refreshSongsButton = document.getElementById('refreshSongsButton');
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    const adminMessageArea = document.getElementById('adminMessageArea');
    const tableHeaders = document.querySelectorAll('#requestsTable th[data-sort]');

    let songs = [];
    let autoRefreshInterval = null;
    const REFRESH_INTERVAL_MS = 15000; // Auto-refresh every 15 seconds
    let currentSort = { column: 'timestamp', order: 'asc' }; // Default: unplayed first, then oldest


    async function fetchSongs() {
        try {
            const response = await fetch('/api/songs');
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Error fetching songs: ${response.status}`);
            }
            songs = await response.json();
            renderSongs();
            showMessage('Song list updated.', 'info');
        } catch (error) {
            console.error('Error fetching songs:', error);
            showMessage(`Error: ${error.message}`, 'error');
        }
    }

    function renderSongs() {
        if (!requestsTableBody) return;
        requestsTableBody.innerHTML = ''; // Clear existing rows

        // Custom sort: unplayed first, then by the currentSort criteria
        const sortedSongs = [...songs].sort((a, b) => {
            if (a.played !== b.played) {
                return a.played ? 1 : -1; // false (unplayed) comes before true (played)
            }
            // If both played or both unplayed, sort by currentSort
            let valA = a[currentSort.column];
            let valB = b[currentSort.column];

            if (currentSort.column === 'timestamp') {
                valA = new Date(valA).getTime();
                valB = new Date(valB).getTime();
            } else if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return currentSort.order === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.order === 'asc' ? 1 : -1;
            return 0;
        });

        if (sortedSongs.length === 0) {
            requestsTableBody.innerHTML = '<tr><td colspan="5">No song requests yet.</td></tr>';
            return;
        }

        sortedSongs.forEach(song => {
            const row = requestsTableBody.insertRow();
            row.className = song.played ? 'played-true' : 'played-false';
            row.dataset.songId = song.id;

            row.insertCell().textContent = new Date(song.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            row.insertCell().textContent = song.name || 'N/A';
            row.insertCell().textContent = song.songTitle;
            row.insertCell().textContent = song.played ? 'Played' : 'Upcoming';
            
            const actionsCell = row.insertCell();
            if (!song.played) {
                const playButton = document.createElement('button');
                playButton.textContent = 'Mark Played';
                playButton.className = 'mark-played-btn';
                playButton.onclick = () => markSongAsPlayed(song.id);
                actionsCell.appendChild(playButton);
            } else {
                 actionsCell.textContent = '✓'; // Or a disabled button, or nothing
            }
        });
        updateSortIndicators();
    }

    async function markSongAsPlayed(songId) {
        try {
            const response = await fetch(`/api/songs/mark-played/${songId}`, { method: 'PUT' });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Error marking song: ${response.status}`);
            }
            // Optimistic update or re-fetch
            const updatedSong = songs.find(s => s.id === songId);
            if (updatedSong) updatedSong.played = true;
            renderSongs(); // Re-render to reflect change and re-sort
            showMessage('Song marked as played.', 'success');
        } catch (error) {
            console.error('Error marking song as played:', error);
            showMessage(`Error: ${error.message}`, 'error');
        }
    }

    function setupAutoRefresh() {
        if (autoRefreshToggle.checked && !autoRefreshInterval) {
            autoRefreshInterval = setInterval(fetchSongs, REFRESH_INTERVAL_MS);
        } else if (!autoRefreshToggle.checked && autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }

    tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const sortColumn = header.dataset.sort;
            if (currentSort.column === sortColumn) {
                currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = sortColumn;
                currentSort.order = 'asc'; // Default to ascending for new column
            }
            renderSongs();
        });
    });

    function updateSortIndicators() {
        tableHeaders.forEach(header => {
            header.classList.remove('sorted-asc', 'sorted-desc');
            if (header.dataset.sort === currentSort.column) {
                header.classList.add(currentSort.order === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }
        });
    }

    function showMessage(text, type = 'info') {
        adminMessageArea.textContent = text;
        adminMessageArea.className = `message-area message-${type}`;
        setTimeout(() => {
            adminMessageArea.textContent = '';
            adminMessageArea.className = 'message-area';
        }, 3000);
    }

    // Initial Load & Event Listeners
    refreshSongsButton.addEventListener('click', fetchSongs);
    autoRefreshToggle.addEventListener('change', setupAutoRefresh);
    
    fetchSongs(); // Load songs on page load
    setupAutoRefresh(); // Start auto-refresh if checked
});