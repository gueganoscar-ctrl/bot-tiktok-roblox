const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const TikTokModule = require('tiktok-live-connector');

const TikTokLiveConnection = TikTokModule.TikTokLiveConnection || TikTokModule.WebcastPushConnection;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3011; // Utilise le port de l'hébergeur ou 3011 par défaut

// Dictionnaires pour stocker les scores et les connexions actives de CHAQUE streamer
let activeConnections = {};
let streamersData = {}; 

io.on('connection', (socket) => {
    // On récupère le pseudo envoyé par la page HTML (ex: ?username=aramstreamla)
    const username = socket.handshake.query.username;
    
    if (!username) return socket.disconnect();

    const cleanUsername = username.toLowerCase().trim();
    
    // Le joueur rejoint une "chambre" (room) Socket.io exclusive à ce streamer
    socket.join(cleanUsername);
    console.log(`🔌 Un overlay s'est connecté pour le streamer : @${cleanUsername}`);

    // Si on n'est pas encore connecté au TikTok de ce streamer, on crée la connexion
    if (!activeConnections[cleanUsername]) {
        
        streamersData[cleanUsername] = { likers: {}, gifters: {} };

        const tiktok = new TikTokLiveConnection(cleanUsername, {
            processInitialData: false,
            enableExtendedGiftInfo: false,
            signApiKey: "euler_ZTE3ZmMxMzY1MDNjZGViNWY2NjE1ZTg4ZTdhNjVlY2MxY2Q3YjM2NGViYmU4MTQwYjA4ODk2"
        });

        tiktok.connect().then(() => {
            console.log(`✅ Connecté au live TikTok de @${cleanUsername}`);
        }).catch(err => {
            console.error(`❌ Erreur TikTok pour @${cleanUsername} :`, err.message);
        });

        // --- GESTION DES LIKES ---
        tiktok.on('like', data => {
            const userId = data.user?.displayId || "inconnu";
            const nickname = data.user?.nickname || "Anonyme";
            const likeCount = data.count || 1;
            
            let profilePic = `https://ui-avatars.com/api/?name=${nickname}&background=random`;
            if (data.user?.avatarThumb?.urlList?.length > 0) profilePic = data.user.avatarThumb.urlList[0];

            let uData = streamersData[cleanUsername].likers;
            if (!uData[userId]) uData[userId] = { nickname, profilePictureUrl: profilePic, likes: 0 };
            uData[userId].likes += likeCount;

            const top3Likes = Object.values(uData).sort((a, b) => b.likes - a.likes).slice(0, 3);
            
            // On envoie le top 3 UNIQUEMENT dans la chambre de ce streamer
            io.to(cleanUsername).emit('updateTopLikers', top3Likes);
        });

        // --- GESTION DES PIÈCES ---
        tiktok.on('gift', data => {
            if (data.gift?.type === 1 && !data.repeatEnd) return;

            const userId = data.user?.displayId || data.uniqueId || "inconnu";
            const nickname = data.user?.nickname || data.nickname || "Anonyme";
            const totalCoins = (data.gift?.diamondCount || 0) * (data.repeatCount || 1);

            if (totalCoins === 0) return;

            let profilePic = data.profilePictureUrl || `https://ui-avatars.com/api/?name=${nickname}&background=random`;
            if (!data.profilePictureUrl && data.user?.avatarThumb?.urlList?.length > 0) profilePic = data.user.avatarThumb.urlList[0];

            let gData = streamersData[cleanUsername].gifters;
            if (!gData[userId]) gData[userId] = { nickname, profilePictureUrl: profilePic, coins: 0 };
            gData[userId].coins += totalCoins;

            const top3Gifters = Object.values(gData).sort((a, b) => b.coins - a.coins).slice(0, 3);
            
            // On envoie le top 3 UNIQUEMENT dans la chambre de ce streamer
            io.to(cleanUsername).emit('updateTopGifters', top3Gifters);
        });

        // On garde la connexion en mémoire
        activeConnections[cleanUsername] = tiktok;
    } else {
        // Si le bot tournait déjà pour ce streamer, on renvoie direct les scores actuels au nouvel arrivant
        const uData = streamersData[cleanUsername].likers;
        const gData = streamersData[cleanUsername].gifters;
        socket.emit('updateTopLikers', Object.values(uData).sort((a, b) => b.likes - a.likes).slice(0, 3));
        socket.emit('updateTopGifters', Object.values(gData).sort((a, b) => b.coins - a.coins).slice(0, 3));
    }

    socket.on('disconnect', () => {
        console.log(`❌ Un overlay s'est déconnecté.`);
        // Optionnel : Tu pourrais couper la connexion TikTok si la room est totalement vide (0 spectateur)
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Serveur PUBLIC multi-users lancé sur le port ${PORT} !`);
});
