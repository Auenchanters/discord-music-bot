const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');
const http = require('http');
require('dotenv').config();

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// Music queue storage
const queues = new Map();

console.log('🚀 Discord Music Bot with play-dl starting...');

// Keep-alive server
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    
    const uptime = Math.floor(process.uptime() / 60);
    const status = client.isReady() ? 'Online' : 'Starting';
    const guilds = client.guilds ? client.guilds.cache.size : 0;
    
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Discord Music Bot - ${status}</title>
            <style>
                body { font-family: Arial, sans-serif; background: #2f3136; color: white; text-align: center; padding: 50px; }
                h1 { color: #7289da; }
                .status { background: ${client.isReady() ? '#43b581' : '#faa61a'}; padding: 15px; border-radius: 5px; display: inline-block; margin: 20px; }
            </style>
        </head>
        <body>
            <h1>🎵 Discord Music Bot</h1>
            <div class="status">✅ ${status}</div>
            <p>🤖 Bot: ${client.user ? client.user.tag : 'Loading...'}</p>
            <p>📊 Servers: ${guilds}</p>
            <p>⏰ Uptime: ${uptime} minutes</p>
            <p>🎵 Active Queues: ${queues.size}</p>
            <p>📅 Last Check: ${new Date().toLocaleString()}</p>
            <p style="color: #43b581;">✅ Service Healthy - Using play-dl</p>
        </body>
        </html>
    `);
});

server.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online and ready!`);
    console.log(`🎵 Serving ${client.guilds.cache.size} servers`);
    
    client.user.setPresence({
        activities: [{ name: '/play - Working Music Bot! 🎵', type: 2 }],
        status: 'online'
    });
    
    // Register slash command
    const command = new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play music from YouTube')
        .addStringOption(option =>
            option.setName('song')
                .setDescription('Song name or YouTube URL')
                .setRequired(true));

    try {
        await client.application.commands.create(command);
        console.log('✅ /play command registered successfully!');
    } catch (error) {
        console.error('❌ Command registration failed:', error);
    }
});

// Handle interactions
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
            await handlePlayCommand(interaction);
        } else if (interaction.isButton()) {
            await handleButtons(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await handleVolumeMenu(interaction);
        }
    } catch (error) {
        console.error('❌ Interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Something went wrong!', ephemeral: true });
        }
    }
});

// Play command handler with play-dl
async function handlePlayCommand(interaction) {
    const song = interaction.options.getString('song');
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    console.log(`🎵 Play request: "${song}" from ${member.user.username}`);

    if (!voiceChannel) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Voice Channel Required')
                .setDescription('You need to join a voice channel first!')],
            ephemeral: true
        });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Missing Permissions')
                .setDescription('I need permission to connect and speak in voice channels!')],
            ephemeral: true
        });
    }

    await interaction.deferReply();

    try {
        let videoData;
        let searchUsed = false;
        
        // Check if it's a direct YouTube URL
        if (play.yt_validate(song) === 'video') {
            console.log(`🔍 Direct YouTube URL: ${song}`);
            videoData = await play.video_info(song);
        } else {
            console.log(`🔍 Searching YouTube for: "${song}"`);
            const searchResults = await play.search(song, { limit: 1, source: { youtube: "video" } });
            
            if (!searchResults || searchResults.length === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('❌ No Results Found')
                        .setDescription(`No results found for: **${song}**`)
                        .addFields({ 
                            name: 'Try:', 
                            value: '• Different search terms\n• Artist + song name\n• Direct YouTube URL', 
                            inline: false 
                        })]
                });
            }
            
            videoData = searchResults[0];
            searchUsed = true;
        }

        if (!videoData) {
            throw new Error('Video data not available');
        }

        // Create track object
        const track = {
            title: videoData.title || 'Unknown Title',
            url: videoData.url,
            duration: formatDuration(videoData.durationInSec || 0),
            thumbnail: videoData.thumbnails?.?.url || null,
            requester: interaction.user,
            videoData: videoData
        };

        console.log(`🎵 Adding track: "${track.title}" (${track.duration})`);

        await addToQueue(interaction.guild.id, track, voiceChannel);
        
        const embed = new EmbedBuilder()
            .setTitle('🎵 Now Playing')
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
                { name: '⏱️ Duration', value: track.duration, inline: true },
                { name: '👤 Requested by', value: track.requester.username, inline: true },
                { name: '🔍 Source', value: searchUsed ? 'YouTube Search' : 'Direct URL', inline: true }
            )
            .setColor('#00FF00')
            .setTimestamp();

        if (track.thumbnail) {
            embed.setThumbnail(track.thumbnail);
        }

        const buttons = createControlButtons();

        await interaction.editReply({
            embeds: [embed],
            components: [buttons]
        });

        console.log(`✅ Successfully queued: "${track.title}"`);

    } catch (error) {
        console.error('❌ Play command error:', error);
        
        let errorMessage = 'Failed to play the requested song.';
        if (error.message.includes('unavailable')) {
            errorMessage = 'This video is unavailable or region-restricted.';
        } else if (error.message.includes('private')) {
            errorMessage = 'This video is private.';
        }
        
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Playback Error')
                .setDescription(errorMessage)
                .addFields({ 
                    name: 'What you can try:', 
                    value: '• Try a different song\n• Use a direct YouTube URL\n• Wait a moment and try again', 
                    inline: false 
                })]
        });
    }
}

// Queue management
async function addToQueue(guildId, track, voiceChannel) {
    let queue = queues.get(guildId);

    if (!queue) {
        console.log(`🆕 Creating new queue for guild: ${guildId}`);
        queue = {
            voiceChannel,
            connection: null,
            player: createAudioPlayer(),
            songs: [],
            volume: 50,
            playing: false
        };
        queues.set(guildId, queue);
    }

    queue.songs.push(track);

    if (!queue.connection) {
        try {
            queue.connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guildId,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: false
            });

            queue.connection.subscribe(queue.player);
            
            queue.player.on(AudioPlayerStatus.Idle, () => {
                console.log('⏯️ Player idle, checking queue...');
                queue.songs.shift();
                if (queue.songs.length > 0) {
                    playNext(guildId);
                } else {
                    queue.playing = false;
                    console.log('📭 Queue empty');
                    
                    // Auto-disconnect after 5 minutes
                    setTimeout(() => {
                        const currentQueue = queues.get(guildId);
                        if (currentQueue && currentQueue.songs.length === 0 && !currentQueue.playing) {
                            console.log('🚪 Auto-disconnecting from idle channel');
                            cleanup(guildId);
                        }
                    }, 300000);
                }
            });

            queue.player.on('error', error => {
                console.error('❌ Audio player error:', error);
                queue.songs.shift();
                if (queue.songs.length > 0) {
                    setTimeout(() => playNext(guildId), 2000);
                } else {
                    queue.playing = false;
                }
            });

            queue.connection.on(VoiceConnectionStatus.Disconnected, () => {
                console.log('🔌 Voice connection disconnected');
                setTimeout(() => cleanup(guildId), 5000);
            });

            console.log('✅ Successfully connected to voice channel');

        } catch (error) {
            console.error('❌ Failed to connect to voice channel:', error);
            queues.delete(guildId);
            throw new Error('Failed to join voice channel');
        }
    }

    if (!queue.playing && queue.songs.length === 1) {
        playNext(guildId);
    }
}

// Play next song using play-dl
async function playNext(guildId) {
    const queue = queues.get(guildId);
    if (!queue || queue.songs.length === 0) {
        console.log(`⚠️ No queue or songs found for guild: ${guildId}`);
        return;
    }

    const song = queue.songs[0];
    console.log(`🎵 Now playing: "${song.title}"`);

    try {
        // Get audio stream using play-dl (much more reliable than ytdl-core)
        const stream = await play.stream(song.url, { quality: 2 });
        
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true
        });
        
        if (resource.volume) {
            resource.volume.setVolume(queue.volume / 100);
        }
        
        queue.player.play(resource);
        queue.playing = true;
        
        console.log(`✅ Started playing: "${song.title}"`);
        
    } catch (error) {
        console.error(`❌ Error playing song: ${error.message}`);
        
        // Remove problematic song and try next
        queue.songs.shift();
        if (queue.songs.length > 0) {
            console.log('⏭️ Trying next song...');
            setTimeout(() => playNext(guildId), 3000);
        } else {
            queue.playing = false;
            console.log('❌ No more songs to try');
        }
    }
}

// Button handlers
async function handleButtons(interaction) {
    const queue = queues.get(interaction.guild.id);
    if (!queue) {
        return interaction.reply({ content: '❌ No music playing!', ephemeral: true });
    }

    try {
        switch (interaction.customId) {
            case 'pause':
                if (queue.player.state.status === AudioPlayerStatus.Playing) {
                    queue.player.pause();
                    await interaction.reply({ content: '⏸️ Music paused!', ephemeral: true });
                } else if (queue.player.state.status === AudioPlayerStatus.Paused) {
                    queue.player.unpause();
                    await interaction.reply({ content: '▶️ Music resumed!', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
                }
                break;

            case 'skip':
                queue.player.stop();
                await interaction.reply({ content: '⏭️ Song skipped!', ephemeral: true });
                break;

            case 'stop':
                queue.songs = [];
                queue.player.stop();
                cleanup(interaction.guild.id);
                await interaction.reply({ content: '⏹️ Music stopped!', ephemeral: true });
                break;

            case 'volume':
                const volumeMenu = createVolumeMenu(queue.volume);
                await interaction.reply({
                    content: `🔊 Current volume: **${queue.volume}%**`,
                    components: [volumeMenu],
                    ephemeral: true
                });
                break;
        }
    } catch (error) {
        console.error('❌ Button error:', error);
        await interaction.reply({ content: '❌ Button failed!', ephemeral: true });
    }
}

// Volume menu handler
async function handleVolumeMenu(interaction) {
    const queue = queues.get(interaction.guild.id);
    if (!queue) {
        return interaction.reply({ content: '❌ No music playing!', ephemeral: true });
    }

    const volume = parseInt(interaction.values[0]);
    queue.volume = volume;
    
    if (queue.player.state.resource?.volume) {
        queue.player.state.resource.volume.setVolume(volume / 100);
    }
    
    await interaction.update({
        content: `🔊 Volume set to **${volume}%**!`,
        components: []
    });
    
    console.log(`🔊 Volume changed to ${volume}%`);
}

// Control buttons
function createControlButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('pause')
                .setLabel('⏸️ Pause')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('skip')
                .setLabel('⏭️ Skip')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('stop')
                .setLabel('⏹️ Stop')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('volume')
                .setLabel('🔊 Volume')
                .setStyle(ButtonStyle.Secondary)
        );
}

// Volume menu
function createVolumeMenu(currentVolume) {
    const options = [
        { label: '25%', value: '25', emoji: '🔈' },
        { label: '50%', value: '50', emoji: '🔉' },
        { label: '75%', value: '75', emoji: '🔊' },
        { label: '100%', value: '100', emoji: '🔊' }
    ];

    options.forEach(option => {
        option.default = parseInt(option.value) === currentVolume;
    });

    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('volume_select')
                .setPlaceholder(`Current: ${currentVolume}% - Select volume`)
                .addOptions(options)
        );
}

// Cleanup function
function cleanup(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return;

    console.log(`🧹 Cleaning up for guild: ${guildId}`);

    try {
        if (queue.player) queue.player.stop(true);
        if (queue.connection) queue.connection.destroy();
    } catch (error) {
        console.error('Cleanup error:', error);
    }

    queues.delete(guildId);
    console.log(`✅ Cleanup completed`);
}

// Format duration
function formatDuration(seconds) {
    if (!seconds || seconds === 0) return 'Live/Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🔄 Shutting down...');
    for (const guildId of queues.keys()) {
        cleanup(guildId);
    }
    client.destroy();
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    console.log('🔄 Received SIGTERM...');
    for (const guildId of queues.keys()) {
        cleanup(guildId);
    }
    client.destroy();
    server.close(() => process.exit(0));
});

// Error handling
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// Login
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN not set!');
    process.exit(1);
}

console.log('🔐 Logging in to Discord...');
client.login(process.env.DISCORD_TOKEN)
    .then(() => console.log('✅ Login successful!'))
    .catch(error => {
        console.error('❌ Login failed:', error);
        process.exit(1);
    });
