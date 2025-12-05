const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const rooms = {};
const questionSets = {
    '4h8z3k': [
        { id: 1, text: 'What is the capital of France?', answers: ['Berlin', 'Paris', 'Madrid', 'Rome'], correct: 'Paris' },
        { id: 2, text: 'What is 7 multiplied by 8?', answers: ['49', '56', '64', '72'], correct: '56' },
        { id: 3, text: 'Which is a primary color?', answers: ['Green', 'Orange', 'Blue', 'Purple'], correct: 'Blue' },
        { id: 4, text: 'Gimkit was created by whom?', answers: ['Josh Feinsilber', 'Elon Musk', 'Bill Gates', 'Mark Zuckerberg'], correct: 'Josh Feinsilber' }
    ]
};

const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const calculateEarnings = (player) => {
    let base = 100 * player.multiplierLevel;
    let streakBonus = player.streak * player.streakBonusLevel * 20;
    return base + streakBonus;
};

const getNextQuestion = (room) => {
    const questions = questionSets[room.questionSetId];
    const playerEmails = Object.keys(room.players);
    let potentialQuestions = [...questions];

    for (const email of playerEmails) {
        const player = room.players[email];
        player.wrongQuestions.forEach(qId => {
            for (let i = 0; i < 4; i++) {
                potentialQuestions.push(questions.find(q => q.id === qId));
            }
        });
    }

    const randomIndex = Math.floor(Math.random() * potentialQuestions.length);
    return potentialQuestions[randomIndex];
};

const checkGameEnd = (roomCode) => {
    const room = rooms[roomCode];
    if (room.status !== 'playing') return;

    if (room.gameType === 'Classic: Time') {
        const elapsed = (Date.now() - room.startedAt) / 60000;
        if (elapsed >= room.timeLimitMinutes) {
            endGame(roomCode);
        }
    } else if (room.gameType === 'Classic: Race') {
        for (const email in room.players) {
            if (room.players[email].money >= room.goalAmount) {
                room.winnerEmail = email;
                endGame(roomCode);
                break;
            }
        }
    }
};

const endGame = (roomCode) => {
    const room = rooms[roomCode];
    room.status = 'finished';

    let winner = room.players[room.winnerEmail];
    if (!winner) {
        const playersArray = Object.values(room.players);
        playersArray.sort((a, b) => b.money - a.money);
        winner = playersArray[0];
        room.winnerEmail = winner.playerEmail;
    }

    io.to(roomCode).emit('game_finished', {
        winnerName: winner.playerName,
        finalRankings: Object.values(room.players).sort((a, b) => b.money - a.money)
    });
};

io.on('connection', (socket) => {
    let currentRoomCode = null;
    let playerEmail = null;

    socket.on('create_room', (settings) => {
        currentRoomCode = generateCode();
        playerEmail = settings.hostEmail;
        rooms[currentRoomCode] = {
            roomCode: currentRoomCode,
            hostEmail: playerEmail,
            questionSetId: settings.questionSetId,
            status: 'lobby',
            gameType: settings.gameType,
            timeLimitMinutes: settings.timeLimitMinutes,
            goalAmount: settings.goalAmount,
            players: {}
        };
        rooms[currentRoomCode].players[playerEmail] = { 
            playerEmail, playerName: 'Host Player', money: 0, streak: 0, 
            multiplierLevel: 1, streakBonusLevel: 1, insuranceCount: 1, wrongQuestions: [] 
        };
        socket.join(currentRoomCode);
        socket.emit('room_created', { code: currentRoomCode, sets: Object.keys(questionSets) });
        io.to(currentRoomCode).emit('lobby_update', Object.values(rooms[currentRoomCode].players));
    });

    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostEmail !== playerEmail || room.status !== 'lobby') return;
        
        room.status = 'playing';
        room.startedAt = Date.now();
        io.to(roomCode).emit('game_started', room);

        io.to(roomCode).emit('new_question', getNextQuestion(room));
    });

    socket.on('join_room', ({ code, name, email }) => {
        const room = rooms[code];
        if (!room || room.status !== 'lobby') return socket.emit('join_failed', 'Room not found or game started.');
        
        currentRoomCode = code;
        playerEmail = email;
        room.players[email] = { 
            playerEmail: email, playerName: name, money: 0, streak: 0, 
            questions_answered: 0, correct_answers: 0, 
            multiplierLevel: 1, streakBonusLevel: 1, insuranceCount: 1, wrongQuestions: [] 
        };
        socket.join(code);
        socket.emit('join_success', room);
        io.to(code).emit('lobby_update', Object.values(room.players));
    });

    socket.on('submit_answer', ({ answer, questionId }) => {
        const room = rooms[currentRoomCode];
        const player = room.players[playerEmail];
        const question = questionSets[room.questionSetId].find(q => q.id === questionId);
        
        if (!room || !player || !question || room.status !== 'playing') return;

        player.questions_answered++;
        const isCorrect = answer === question.correct;
        const earnings = calculateEarnings(player);
        let feedback = '';

        if (isCorrect) {
            player.correct_answers++;
            player.money += earnings;
            player.streak++;
            feedback = `Correct! +$${earnings.toLocaleString()}`;
            player.wrongQuestions = player.wrongQuestions.filter(qId => qId !== questionId);
        } else {
            if (player.insuranceCount > 0) {
                player.insuranceCount--;
                feedback = `Wrong! Streak Saved! Insurance used.`;
            } else {
                player.streak = 0;
                feedback = `Wrong! Streak Broken.`;
            }
            if (!player.wrongQuestions.includes(questionId)) {
                 player.wrongQuestions.push(questionId);
            }
        }
        
        io.to(playerEmail).emit('answer_feedback', { isCorrect, earnings: isCorrect ? earnings : 0, feedback });
        
        io.to(currentRoomCode).emit('leaderboard_update', Object.values(room.players));
        io.to(currentRoomCode).emit('new_question', getNextQuestion(room));

        checkGameEnd(currentRoomCode);
    });
    
    socket.on('buy_upgrade', (type) => {
        const room = rooms[currentRoomCode];
        const player = room.players[playerEmail];
        let cost = 0;

        switch(type) {
            case 'multiplier':
                cost = 1000 * (player.multiplierLevel + 1);
                if (player.money >= cost) {
                    player.money -= cost;
                    player.multiplierLevel++;
                    io.to(playerEmail).emit('shop_feedback', `Multiplier upgraded to Lvl ${player.multiplierLevel}!`);
                }
                break;
            case 'streak_bonus':
                cost = 500 * (player.streakBonusLevel + 1);
                if (player.money >= cost) {
                    player.money -= cost;
                    player.streakBonusLevel++;
                    io.to(playerEmail).emit('shop_feedback', `Streak Bonus upgraded to Lvl ${player.streakBonusLevel}!`);
                }
                break;
            case 'insurance':
                cost = 2500;
                if (player.money >= cost) {
                    player.money -= cost;
                    player.insuranceCount++;
                    io.to(playerEmail).emit('shop_feedback', `1 Insurance bought!`);
                }
                break;
        }

        io.to(currentRoomCode).emit('leaderboard_update', Object.values(room.players));
        io.to(playerEmail).emit('player_stats_update', player);
    });

    socket.on('disconnect', () => {
        if (currentRoomCode && rooms[currentRoomCode]) {
            delete rooms[currentRoomCode].players[playerEmail];
            io.to(currentRoomCode).emit('lobby_update', Object.values(rooms[currentRoomCode].players));
        }
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Quiz server running on http://localhost:${PORT}`);
});
