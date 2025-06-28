# Quick Start Guide

## 1. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit with your credentials
nano .env
```

## 2. Required Configuration

### Telegram Setup
1. Go to [my.telegram.org](https://my.telegram.org)
2. Create an application to get `API_ID` and `API_HASH`
3. Add your phone number and target channel

### Eitaa Setup
1. Go to [eitaayar.ir](https://eitaayar.ir)
2. Create a bot and get your token
3. Add your bot to the target channel/chat
4. Get the chat ID or use username

## 3. Run the Service

### Option A: Full Service (Recommended)
```bash
bun run start
```
This runs both Telegram monitoring and Eitaa syncing together.

### Option B: Telegram Only
Leave `EITAA_TOKEN` and `EITAA_CHAT_ID` empty in `.env`, then:
```bash
bun run start
```

### Option C: Eitaa Sync Only
If you already have data stored:
```bash
bun run sync-only
```

## 4. What Happens

1. **First Run**: 
   - Authenticates with Telegram (you'll need to enter verification code)
   - Tests Eitaa connection
   - Syncs recent posts
   - Starts real-time monitoring

2. **Subsequent Runs**:
   - Uses saved session (no re-authentication needed)
   - Continues from where it left off
   - Syncs any missed posts

## 5. File Structure Created

```
data/
├── post_*.json           # Message metadata
├── eitaa_processed.json   # Sync tracking
└── media/
    └── */                 # Downloaded media files
```

## 6. Monitoring

Watch the console output for:
- ✅ Successful operations
- ❌ Errors that need attention
- 📱 Telegram events
- 📤 Eitaa sync status

## 7. Stopping

Press `Ctrl+C` to gracefully stop the service. It will:
- Save current progress
- Close connections properly
- Allow resuming later

## Troubleshooting

- **"Missing environment variables"**: Check your `.env` file
- **"Authentication failed"**: Verify API credentials and phone number
- **"Eitaa connection failed"**: Check token and chat ID
- **"Permission denied"**: Ensure bot has access to the target chat

For detailed troubleshooting, see the main README.md file.