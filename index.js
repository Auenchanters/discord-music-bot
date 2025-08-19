const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytsearch = require('yt-search');
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

console.log('🚀 Discord Music Bot starting up...');

// Keep-alive server for Render
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <html>
        <head><title>Discord Music Bot - Online</title></head>
        <body style="background: #2f3136; color: white; text-align: center; padding: 50px; font-family: Arial;">
            <h1 style="color: #7289da;">🎵 Discord Music Bot</h1>
            <div style="background: #43b581; padding: 10px; border-radius: 5px; display: inline-block;">✅ Bot is Online!</div>
            <p>Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
        </body>
        </html>
    `);
});

server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    
    client.user.setPresence({
        activities: [{ name: '/play - Music Bot', type: 2 }],
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
        console.log('✅ Commands registered!');
    } catch (error) {
        console.error('❌ Command registration failed:', error);
    }
});

// Handle interactions
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
        await handlePlayCommand(interaction);
    } else if (interaction.isButton()) {
        await handleButtons(interaction);
    } else if (interaction.isStringSelectMenu()) {
        await handleVolumeMenu(interaction);
    }
});

// Play command handler
async function handlePlayCommand(interaction) {
    const song = interaction.options.getString('song');
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({
            content: '❌ You need to be in a voice channel!',
            ephemeral: true
        });
    }

    await interaction.deferReply();

    try {
        let videoInfo;
        
        if (ytdl.validateURL(song)) {
            videoInfo = await ytdl.getInfo(song);
        } else {
            const searchResults = await ytsearch(song);
            if (!searchResults.videos.length) {
                return interaction.editReply('❌ No results found!');
            }
            videoInfo = await ytdl.getInfo(searchResults.videos[0].url);
        }

        const track = {
            title: videoInfo.videoDetails.title,
            url: videoInfo.videoDetails.video_url,
            duration: formatDuration(videoInfo.videoDetails.lengthSeconds),
            thumbnail: videoInfo.videoDetails.thumbnails?.url,
            requester: interaction.user
        };

        await addToQueue(interaction.guild.id, track, voiceChannel);
        
        const embed = new EmbedBuilder()
            .setTitle('🎵 Now Playing')
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
                { name: '⏱️ Duration', value: track.duration, inline: true },
                { name: '👤 Requested by', value: track.requester.username, inline: true }
            )
            .setThumbnail(track.thumbnail)
            .setColor('#FF0000');

        const buttons = new ActionRowBuilder()
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

        await interaction.editReply({
            embeds: [embed],
            components: [buttons]
        });

    } catch (error) {
        console.error('Play error:', error);
        await interaction.editReply('❌ Failed to play song!');
    }
}

// Queue management
async function addToQueue(guildId, track, voiceChannel) {
    let queue = queues.get(guildId);

    if (!queue) {
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
        queue.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });

        queue.connection.subscribe(queue.player);
        
        queue.player.on(AudioPlayerStatus.Idle, () => {
            queue.songs.shift();
            if (queue.songs.length > 0) {
                playNext(guildId);
            } else {
                queue.playing = false;
            }
        });
    }

    if (!queue.playing && queue.songs.length === 1) {
        playNext(guildId);
    }
}

// Play next song
async function playNext(guildId) {
    const queue = queues.get(guildId);
    if (!queue || queue.songs.length === 0) return;

    const song = queue.songs[0];
    
    try {
        const stream = ytdl(song.url, { 
            filter: 'audioonly',
            quality: 'highestaudio'
        });
        
        const resource = createAudioResource(stream);
        queue.player.play(resource);
        queue.playing = true;
    } catch (error) {
        console.error('Playback error:', error);
        queue.songs.shift();
        if (queue.songs.length > 0) {
            playNext(guildId);
        }
    }
}

// Button handlers
async function handleButtons(interaction) {
    const queue = queues.get(interaction.guild.id);
    if (!queue) {
        return interaction.reply({ content: '❌ No music playing!', ephemeral: true });
    }

    switch (interaction.customId) {
        case 'pause':
            if (queue.player.state.status === AudioPlayerStatus.Playing) {
                queue.player.pause();
                await interaction.reply({ content: '⏸️ Paused!', ephemeral: true });
            } else {
                queue.player.unpause();
                await interaction.reply({ content: '▶️ Resumed!', ephemeral: true });
            }
            break;

        case 'skip':
            queue.player.stop();
            await interaction.reply({ content: '⏭️ Skipped!', ephemeral: true });
            break;

        case 'stop':
            queue.songs = [];
            queue.player.stop();
            queue.connection?.destroy();
            queues.delete(interaction.guild.id);
            await interaction.reply({ content: '⏹️ Stopped!', ephemeral: true });
            break;

        case 'volume':
            const volumeMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('volume_select')
                        .setPlaceholder('Select Volume')
                        .addOptions([
                            { label: '25%', value: '25' },
                            { label: '50%', value: '50' },
                            { label: '75%', value: '75' },
                            { label: '100%', value: '100' }
                        ])
                );
            
            await interaction.reply({
                content: `🔊 Current volume: ${queue.volume}%`,
                components: [volumeMenu],
                ephemeral: true
            });
            break;
    }
}

// Volume menu handler
async function handleVolumeMenu(interaction) {
    const queue = queues.get(interaction.guild.id);
    if (!queue) return;

    const volume = parseInt(interaction.values[0]);
    queue.volume = volume;
    
    await interaction.update({
        content: `🔊 Volume set to ${volume}%`,
        components: []
    });
}

// Utility functions
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Error handling
process.on('unhandledRejection', console.error);

// Login - NOTICE: This uses environment variable, NOT a hardcoded token!
client.login(process.env.DISCORD_TOKEN);
