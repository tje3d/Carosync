# CaroSync - Telegram to Eitaa Bridge

A powerful service that monitors Telegram channels and automatically syncs content to Eitaa platform. CaroSync downloads media files, preserves message formatting, and handles media groups seamlessly.

## Features

- 📱 **Telegram Channel Monitoring**: Real-time monitoring of Telegram channels
- 📤 **Eitaa Integration**: Automatic syncing to Eitaa channels/chats
- 📁 **Media Download**: Downloads and syncs photos, videos, documents, and voice messages
- 🖼️ **Media Groups**: Handles album/media group posts correctly
- 🔄 **Edit Detection**: Syncs edited messages and media
- 📌 **Pin Support**: Tracks pinned messages
- 🗑️ **Delete Handling**: Marks deleted messages appropriately
- 💾 **Persistent Storage**: Saves all data locally with JSON format
- 🔄 **Resume Support**: Continues from where it left off after restart

## Setup

### 1. Prerequisites

- [Bun](https://bun.sh/) runtime
- Telegram API credentials
- Eitaa API token

### 2. Installation

```bash
# Clone the repository
git clone <repository-url>
cd carosync

# Install dependencies
bun install
```

### 3. Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` file with your credentials:

#### Telegram Configuration
- Get `API_ID` and `API_HASH` from [my.telegram.org](https://my.telegram.org)
- Set your phone number in `PHONE`
- Set the channel username or ID in `CHANNEL`

#### Eitaa Configuration
- Get your bot token from [eitaayar.ir](https://eitaayar.ir) panel
- Set `EITAA_TOKEN` with your bot token
- Set `EITAA_CHAT_ID` with your target channel/chat ID or username (without @)

```env
# Telegram API Configuration
API_ID=your_api_id
API_HASH=your_api_hash
SESSION=
PHONE=+1234567890
CHANNEL=@your_channel

# Eitaa API Configuration
EITAA_TOKEN=your_eitaa_token
EITAA_CHAT_ID=your_chat_id

# Optional settings
STORAGE_PATH=./data
SYNC_LIMIT=5
```

## Usage

### Full Service (Telegram + Eitaa)

Run both Telegram monitoring and Eitaa syncing:

```bash
bun run start
```

This will:
1. Start monitoring the Telegram channel
2. Download and store new messages/media
3. Automatically sync everything to Eitaa

### Eitaa Sync Only

If you already have data stored and want to sync only to Eitaa:

```bash
bun run sync-only
```

### Development Mode

Run with auto-restart on file changes:

```bash
bun run dev
```

## How It Works

### Telegram Monitoring (`src/index.ts`)

1. **Authentication**: Uses your phone number and Telegram API credentials
2. **Real-time Monitoring**: Listens for new messages, edits, deletions, and pins
3. **Media Download**: Downloads all media files with progress tracking
4. **Data Storage**: Saves message data as JSON files and media in organized folders
5. **Media Groups**: Handles album posts by grouping related messages

### Eitaa Syncing (`src/eitaa-sync.ts`)

1. **Connection Test**: Verifies Eitaa API credentials on startup
2. **Existing Data Sync**: Syncs any previously stored posts that haven't been sent
3. **Real-time Sync**: Watches for new post files and syncs them immediately
4. **Rate Limiting**: Implements delays to respect API limits
5. **Progress Tracking**: Keeps track of synced posts to avoid duplicates

## File Structure

```
data/
├── post_123.json          # Message metadata
├── post_group_456.json     # Media group metadata
├── media/
│   ├── 123/               # Media for message 123
│   │   ├── photo_789.jpg
│   │   └── video_790.mp4
│   └── 456/               # Media for message 456
└── eitaa_processed.json   # Tracking synced posts
```

## API Reference

### Eitaa API Methods Used

- `getMe`: Test connection and get bot info
- `sendMessage`: Send text messages
- `sendFile`: Send media files with optional captions

For detailed Eitaa API documentation, see `doc/eitaa.md`.

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify your API_ID and API_HASH
   - Make sure phone number format is correct (+1234567890)
   - Check if 2FA is enabled and provide password when prompted

2. **Eitaa Connection Failed**
   - Verify your EITAA_TOKEN is correct
   - Check if EITAA_CHAT_ID exists and bot has access
   - Test API at https://eitaayar.ir/testApi

3. **Media Download Issues**
   - Check available disk space
   - Verify write permissions in storage directory
   - Large files may take time to download

4. **Sync Issues**
   - Check network connectivity
   - Verify Eitaa API rate limits
   - Review logs for specific error messages

### Logs

The service provides detailed logging:
- ✅ Success operations
- ❌ Error messages
- 📱 Telegram events
- 📤 Eitaa sync status
- 📊 Progress indicators

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is private and proprietary.

A Telegram channel synchronization tool that monitors and downloads content from Telegram channels.

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy the example environment file and fill in your details:

```bash
cp .env.example .env
```

Edit the `.env` file with your Telegram API credentials and settings:

```
# Get these values from https://my.telegram.org
API_ID=your_api_id
API_HASH=your_api_hash

# Phone number for authentication
PHONE=+1234567890

# Channel to monitor (username without @)
CHANNEL=channel_name
```

### 3. Run the application

```bash
bun run src/index.ts
```

On first run, you'll be prompted for a verification code sent to your Telegram account. After successful authentication, a session string will be generated and displayed in the console. You can copy this to your `.env` file for future runs.

## Features

- Monitors channels for new posts in real-time
- Downloads media (photos, videos, documents, etc.)
- Tracks edited and deleted messages
- Handles media groups (albums)
- Monitors pinned messages

## Data Storage

All downloaded data is stored in the `./data` directory (or custom path specified in `.env`):

- Post metadata: JSON files in the data root
- Media files: Organized in subdirectories by message ID

---

This project was created using `bun init` in bun v1.2.17. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
