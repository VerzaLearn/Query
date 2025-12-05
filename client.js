const socket = io();
let gameState = {};
let playerStats = { money: 0, streak: 0, multiplierLevel: 1, streakBonusLevel: 1, insuranceCount: 1 };
let currentQuestion = null;
let intervalTimer = null;

const $ = (id) => document.getElementById(id);
const showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    $(id).classList.add('active');
};

const updateUI = () => {
    // This updates costs and levels in the shop UI
    $('mult-lvl').textContent = playerStats.multiplierLevel;
    $('mult-cost').textContent = (1000 * (playerStats.multiplierLevel + 1)).toLocaleString();
    $('sb-lvl').textContent = playerStats.streakBonusLevel;
    $('sb-cost').textContent = (500 * (playerStats.streakBonusLevel + 1)).toLocaleString();
    $('ins-count').textContent = playerStats.insuranceCount;
};

const updateStatsBar = () => {
    const { money, streak } = playerStats;
    $('stat-money').textContent = `Money: $${money.toLocaleString()}`;
    $('stat-streak').textContent = `Streak: ${streak}`;
    
    const progressEl = $('stat-progress');
    if (gameState.gameType === 'Classic: Time') {
        const remaining = gameState.timeLimitMinutes * 60 - ((Date.now() - gameState.startedAt) / 1000);
        const minutes = Math.floor(remaining / 60);
        const seconds = Math.floor(remaining % 60);
        progressEl.textContent = `Time: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else if (gameState.gameType === 'Classic: Race') {
        const percent = Math.min(100, (money / gameState.goalAmount) * 100);
        progressEl.textContent = `Goal: ${percent.toFixed(0)}%`;
        progressEl.style.width = `${percent}%`; // Assuming a visual bar in CSS
    }
};

const startProgressTimer = () => {
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = setInterval(updateStatsBar, 1000);
};

const renderQuestion = (question) => {
    currentQuestion = question;
    $('question-text').textContent = question.text;
    const choicesDiv = $('answer-choices');
    choicesDiv.innerHTML = '';
    
    question.answers.forEach(answer => {
        const btn = document.createElement('button');
        btn.textContent = answer;
        btn.className = 'answer-btn';
        btn.onclick = () => {
            socket.emit('submit_answer', { answer, questionId: question.id });
            choicesDiv.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
        };
        choicesDiv.appendChild(btn);
    });
};

const renderLeaderboard = (players) => {
    players.sort((a, b) => b.money - a.money);
    const list = $('leaderboard-list');
    list.innerHTML = '';
    players.forEach((p, index) => {
        const item = document.createElement('li');
        const moneyDisplay = p.money.toLocaleString();
        item.textContent = `${index + 1}. ${p.playerName} ($${moneyDisplay})`;
        if (p.playerEmail === socket.id) item.classList.add('self');
        list.appendChild(item);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    const randomId = Math.random().toString(36).substring(7);
    const playerEmail = `user_${randomId}@quiz.io`;
    const playerName = 'Player ' + randomId.substring(0, 4);

    $('join-button').onclick = () => {
        const code = $('join-code').value.toUpperCase();
        const name = $('player-name').value || playerName;
        socket.emit('join_room', { code, name, email: playerEmail });
    };

    $('shop-open-button').onclick = () => showScreen('shop-screen');
    $('shop-close-button').onclick = () => showScreen('game-screen');
    
    document.querySelectorAll('[name="game-mode"]').forEach(radio => {
        radio.onchange = (e) => {
            $('time-config').style.display = e.target.value === 'Classic: Time' ? 'block' : 'none';
            $('race-config').style.display = e.target.value === 'Classic: Race' ? 'block' : 'none';
        };
    });
    
    $('create-room-button').onclick = () => {
        const mode = document.querySelector('[name="game-mode"]:checked').value;
        socket.emit('create_room', {
            hostEmail: playerEmail,
            questionSetId: $('question-set-select').value,
            gameType: mode,
            timeLimitMinutes: mode === 'Classic: Time' ? parseInt($('time-limit').value) : 0,
            goalAmount: mode === 'Classic: Race' ? parseInt($('goal-amount').value) : 0
        });
    };

    $('start-game-button').onclick = () => socket.emit('start_game', gameState.roomCode);
    
    document.querySelectorAll('.shop-upgrade-btn').forEach(btn => {
        btn.onclick = () => socket.emit('buy_upgrade', btn.dataset.type);
    });

    if (window.location.hash === '#host') {
        showScreen('host-config-screen');
    }
});

socket.on('room_created', ({ code, sets }) => {
    const select = $('question-set-select');
    select.innerHTML = sets.map(s => `<option value="${s}">${s}</option>`).join('');
    $('room-code-display').textContent = `Code: ${code}`;
    showScreen('lobby-screen');
});

socket.on('join_success', (room) => {
    gameState = room;
    $('room-code-display').textContent = `Code: ${room.roomCode}`;
    showScreen('lobby-screen');
});

socket.on('lobby_update', (players) => {
    const list = $('lobby-list');
    list.innerHTML = '';
    players.forEach(p => {
        const item = document.createElement('li');
        item.textContent = p.playerName;
        list.appendChild(item);
    });
    if (gameState.hostEmail === socket.id && players.length >= 1) { // Allows host to test solo
         $('start-game-button').disabled = false;
    }
});

socket.on('game_started', (room) => {
    gameState = room;
    showScreen('game-screen');
    startProgressTimer();
});

socket.on('new_question', renderQuestion);

socket.on('leaderboard_update', renderLeaderboard);

socket.on('player_stats_update', (stats) => {
    playerStats = stats;
    updateStatsBar();
    updateUI();
});

socket.on('answer_feedback', ({ isCorrect, earnings, feedback }) => {
    const feedbackDiv = $('feedback-display');
    feedbackDiv.textContent = feedback;
    feedbackDiv.className = isCorrect ? 'feedback-correct' : 'feedback-incorrect';
    setTimeout(() => feedbackDiv.textContent = '', 2000); 
});

socket.on('shop_feedback', (message) => {
    alert(message); // Simple alert for shop feedback
    // In a real app, this would be a subtle toaster notification
});

socket.on('game_finished', ({ winnerName, finalRankings }) => {
    clearInterval(intervalTimer);
    $('winner-announcement').textContent = `${winnerName} is the WINNER!`;
    const list = $('final-rankings');
    list.innerHTML = '';
    finalRankings.forEach((p, index) => {
        const item = document.createElement('li');
        item.textContent = `${index + 1}. ${p.playerName} - $${p.money.toLocaleString()}`;
        list.appendChild(item);
    });
    showScreen('end-screen');
});
