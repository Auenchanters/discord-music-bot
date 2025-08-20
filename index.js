const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior } = require('@discordjs/voice');
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

// FIXED: HTTP server that properly responds to health checks
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    // Handle all requests with proper response
    res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
    });
    
    const uptime = Math.floor(process.uptime() / 60);
    const status = client.isReady() ? '✅ Online' : '🔄 Starting';
    const guilds = client.guilds ? client.guilds.cache.size : 0;
    const activeQueues = queues.size;
    
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Discord Music Bot - ${status}</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; 
                    text-align: center; 
                    padding: 50px;
                    margin: 0;
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: rgba(255,255,255,0.1);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                }
                h1 { 
                    color: #fff; 
                    margin-bottom: 30px; 
                    font-size: 2.5em;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
                }
                .status { 
                    background: ${client.isReady() ? '#00ff88' : '#ff9500'}; 
                    color: #000;
                    padding: 15px 30px; 
                    border-radius: 50px; 
                    display: inline-block;
                    margin: 20px 0;
                    font-size: 18px;
                    font-weight: bold;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                }
                .stats {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin: 30px 0;
                    text-align: left;
                }
                .stat {
                    background: rgba(255,255,255,0.1);
                    padding: 20px;
                    border-radius: 10px;
                    border: 1px solid rgba(255,255,255,0.2);
                }
                .stat-value {
                    font-size: 2em;
                    font-weight: bold;
                    color: #00ff88;
                }
                .footer {
                    margin-top: 30px;
                    opacity: 0.8;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎵 Discord Music Bot</h1>
                <div class="status">${status}</div>
                
                <div class="stats">
                    <div class="stat">
                        <div>🤖 Bot User</div>
                        <div class="stat-value">${client.user ? client.user.username : 'Loading...'}</div>
                    </div>
                    <div class="stat">
                        <div>📊 Servers</div>
                        <div class="stat-value">${guilds}</div>
                    </div>
                    <div class="stat">
                        <div>⏰ Uptime</div>
                        <div class="stat-value">${uptime}m</div>
                    </div>
                    <div class="stat">
                        <div>🎵 Active Queues</div>
                        <div class="stat-value">${activeQueues}</div>
                    </div>
                </div>
                
                <div class="footer">
                    <p>✅ Service Healthy & Responding</p>
                    <p>📅 Last Check: ${new Date().toLocaleString()}</p>
                    <p>🔗 Powered by play-dl & discord.js</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}`);
});

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online and ready!`);
    console.log(`🎵 Serving ${client.guilds.cache.size} servers`);
    console.log(`👥 Cached ${client.users.cache.size} users`);
    
    client.user.setPresence({
        activities: [{ name: '/play - Music Bot with Queue! 🎵', type: 2 }],
        status: 'online'
    });
    
    // Register slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('play')
            .setDescription('Play music from YouTube')
            .addStringOption(option =>
                option.setName('song')
                    .setDescription('Song name or YouTube URL')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('queue')
            .setDescription('Show the current music queue'),
        
        new SlashCommandBuilder()
            .setName('skip')
            .setDescription('Skip the current song'),
        
        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('Stop music and clear queue'),
        
        new SlashCommandBuilder()
            .setName('nowplaying')
            .setDescription('Show currently playing song')
    ];

    try {
        for (const command of commands) {
            await client.application.commands.create(command);
        }
        console.log('✅ All commands registered successfully!');
    } catch (error) {
        console.error('❌ Command registration failed:', error);
    }
});

// Handle interactions
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'play':
                    await handlePlayCommand(interaction);
                    break;
                case 'queue':
                    await handleQueueCommand(interaction);
                    break;
                case 'skip':
                    await handleSkipCommand(interaction);
                    break;
                case 'stop':
                    await handleStopCommand(interaction);
                    break;
                case 'nowplaying':
                    await handleNowPlayingCommand(interaction);
                    break;
            }
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

// FIXED: Play command with better error handling
async function handlePlayCommand(interaction) {
    const song = interaction.options.getString('song');
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    console.log(`🎵 Play request: "${song}" from ${member.user.username} in ${interaction.guild.name}`);

    if (!voiceChannel) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Voice Channel Required')
                .setDescription('You need to join a voice channel first!')
                .addFields({ 
                    name: 'How to fix:', 
                    value: '1. Join any voice channel\n2. Use `/play <song>` again', 
                    inline: false 
                })],
            ephemeral: true
        });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Missing Permissions')
                .setDescription('I need permission to connect and speak in voice channels!')
                .addFields({
                    name: 'Required Permissions:',
                    value: '• Connect\n• Speak\n• Use Voice Activity',
                    inline: false
                })],
            ephemeral: true
        });
    }

    await interaction.deferReply();

    try {
        let videoData;
        let searchUsed = false;
        
        // Check if it's a direct YouTube URL
        if (play.yt_validate(song) === 'video') {
            console.log(`🔍 Direct YouTube URL detected: ${song}`);
            videoData = await play.video_info(song);
        } else {
            console.log(`🔍 Searching YouTube for: "${song}"`);
            const searchResults = await play.search(song, { 
                limit: 1, 
                source: { youtube: "video" } 
            });
            
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
            addedAt: Date.now(),
            videoData: videoData
        };

        console.log(`🎵 Adding track: "${track.title}" (${track.duration})`);

        const queue = await addToQueue(interaction.guild.id, track, voiceChannel);
        const position = queue.songs.length;
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTimestamp();

        if (position === 1 && !queue.playing) {
            embed
                .setTitle('🎵 Now Playing')
                .setDescription(`**[${track.title}](${track.url})**`)
                .addFields(
                    { name: '⏱️ Duration', value: track.duration, inline: true },
                    { name: '👤 Requested by', value: track.requester.username, inline: true },
                    { name: '🔍 Source', value: searchUsed ? 'YouTube Search' : 'Direct URL', inline: true }
                );
        } else {
            embed
                .setTitle('📝 Added to Queue')
                .setDescription(`**[${track.title}](${track.url})**`)
                .addFields(
                    { name: '📍 Position in Queue', value: `#${position}`, inline: true },
                    { name: '⏱️ Duration', value: track.duration, inline: true },
                    { name: '👤 Requested by', value: track.requester.username, inline: true }
                );
        }

        if (track.thumbnail) {
            embed.setThumbnail(track.thumbnail);
        }

        const buttons = createControlButtons();

        await interaction.editReply({
            embeds: [embed],
            components: [buttons]
        });

        console.log(`✅ Successfully queued: "${track.title}" at position ${position}`);

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

// NEW: Queue command
async function handleQueueCommand(interaction) {
    const queue = queues.get(interaction.guild.id);
    
    if (!queue || queue.songs.length === 0) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('📭 Queue is Empty')
                .setDescription('No songs in queue! Use `/play <song>` to add some music.')],
            ephemeral: true
        });
    }

    const embed = createQueueEmbed(queue, interaction.guild);
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// NEW: Skip command
async function handleSkipCommand(interaction) {
    const queue = queues.get(interaction.guild.id);
    
    if (!queue || queue.songs.length === 0) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Nothing Playing')
                .setDescription('No music is currently playing!')],
            ephemeral: true
        });
    }

    const skippedSong = queue.songs[0];
    queue.player.stop();
    
    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('⏭️ Song Skipped')
            .setDescription(`Skipped: **${skippedSong.title}**`)
            .addFields({
                name: queue.songs.length > 1 ? 'Up Next' : 'Result',
                value: queue.songs.length > 1 ? `**${queue.songs[1].title}**` : 'Queue is now empty',
                inline: false
            })]
    });
}

// NEW: Stop command  
async function handleStopCommand(interaction) {
    const queue = queues.get(interaction.guild.id);
    
    if (!queue) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Nothing Playing')
                .setDescription('No music is currently playing!')],
            ephemeral: true
        });
    }

    const songsCleared = queue.songs.length;
    queue.songs = [];
    queue.player.stop();
    cleanup(interaction.guild.id);
    
    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⏹️ Music Stopped')
            .setDescription(`Stopped playback and cleared **${songsCleared}** song(s) from queue.`)
            .addFields({
                name: 'Actions Taken:',
                value: '• Stopped current song\n• Cleared queue\n• Left voice channel',
                inline: false
            })]
    });
}

// NEW: Now playing command
async function handleNowPlayingCommand(interaction) {
    const queue = queues.get(interaction.guild.id);
    
    if (!queue || queue.songs.length === 0 || !queue.playing) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Nothing Playing')
                .setDescription('No music is currently playing!')],
            ephemeral: true
        });
    }

    const currentSong = queue.songs[0];
    const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${currentSong.title}](${currentSong.url})**`)
        .addFields(
            { name: '⏱️ Duration', value: currentSong.duration, inline: true },
            { name: '👤 Requested by', value: currentSong.requester.username, inline: true },
            { name: '🔊 Volume', value: `${queue.volume}%`, inline: true },
            { name: '📍 In Queue', value: `${queue.songs.length} song(s)`, inline: true }
        )
        .setColor('#00FF00')
        .setTimestamp(currentSong.addedAt);

    if (currentSong.thumbnail) {
        embed.setThumbnail(currentSong.thumbnail);
    }

    const buttons = createControlButtons();
    await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: true });
}

// FIXED: Queue management with better audio handling
async function addToQueue(guildId, track, voiceChannel) {
    let queue = queues.get(guildId);

    if (!queue) {
        console.log(`🆕 Creating new queue for guild: ${guildId}`);
        queue = {
            voiceChannel,
            connection: null,
            player: createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play
                }
            }),
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
                queue.songs.shift(); // Remove finished song
                if (queue.songs.length > 0) {
                    console.log(`▶️ Playing next song (${queue.songs.length} remaining)`);
                    playNext(guildId);
                } else {
                    queue.playing = false;
                    console.log('📭 Queue empty, stopping playback');
                    
                    // Auto-disconnect after 5 minutes
                    setTimeout(() => {
                        const currentQueue = queues.get(guildId);
                        if (currentQueue && currentQueue.songs.length === 0 && !currentQueue.playing) {
                            console.log('🚪 Auto-disconnecting from idle voice channel');
                            cleanup(guildId);
                        }
                    }, 300000);
                }
            });

            queue.player.on('error', error => {
                console.error('❌ Audio player error:', error);
                queue.songs.shift(); // Remove problematic song
                if (queue.songs.length > 0) {
                    setTimeout(() => playNext(guildId), 3000);
                } else {
                    queue.playing = false;
                }
            });

            queue.connection.on(VoiceConnectionStatus.Disconnected, () => {
                console.log('🔌 Voice connection disconnected');
                setTimeout(() => cleanup(guildId), 5000);
            });

            queue.connection.on('error', error => {
                console.error('❌ Voice connection error:', error);
                cleanup(guildId);
            });

            console.log('✅ Successfully connected to voice channel');

        } catch (error) {
            console.error('❌ Failed to connect to voice channel:', error);
            queues.delete(guildId);
            throw new Error('Failed to join voice channel. Please check my permissions.');
        }
    }

    if (!queue.playing && queue.songs.length === 1) {
        playNext(guildId);
    }

    return queue;
}

// FIXED: Play next song with better audio streaming
async function playNext(guildId) {
    const queue = queues.get(guildId);
    if (!queue || queue.songs.length === 0) {
        console.log(`⚠️ No queue or songs found for guild: ${guildId}`);
        return;
    }

    const song = queue.songs[0];
    console.log(`🎵 Now playing: "${song.title}"`);

    try {
        // FIXED: Get audio stream with better options
        const stream = await play.stream(song.url, { 
            quality: 2,
            discordPlayerCompatibility: false
        });
        
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
        console.error(`❌ Error playing song "${song.title}":`, error.message);
        
        // Remove problematic song and try next
        queue.songs.shift();
        if (queue.songs.length > 0) {
            console.log('⏭️ Trying next song...');
            setTimeout(() => playNext(guildId), 3000);
        } else {
            queue.playing = false;
            console.log('❌ No more songs to try
