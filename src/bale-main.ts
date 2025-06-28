import 'dotenv/config'
import fs from 'fs/promises'
import BaleSync from './bale-sync.js'
;(async () => {
  const API_ID = parseInt(process.env.API_ID || '0')
  const API_HASH = process.env.API_HASH || ''
  const SESSION = process.env.SESSION || ''
  const PHONE = process.env.PHONE || ''
  const CHANNEL = process.env.CHANNEL || ''
  const STORAGE_PATH = process.env.STORAGE_PATH || './data'
  const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '5')

  // Bale configuration
  const BALE_TOKEN = process.env.BALE_TOKEN || ''
  const BALE_CHAT_ID = process.env.BALE_CHAT_ID || ''

  // Validate required environment variables
  if (!API_ID || !API_HASH || !PHONE || !CHANNEL) {
    console.error(
      '❌ Missing required Telegram environment variables. Please check your .env file.',
    )
    console.error('Required: API_ID, API_HASH, PHONE, CHANNEL')
    process.exit(1)
  }

  if (!BALE_TOKEN || !BALE_CHAT_ID) {
    console.error('❌ Missing required Bale environment variables. Please check your .env file.')
    console.error('Required: BALE_TOKEN, BALE_CHAT_ID')
    process.exit(1)
  }

  console.log('🚀 Starting CaroSync - Telegram to Bale Bridge...')
  console.log('📱 Telegram Channel:', CHANNEL)
  console.log('📤 Bale Chat:', BALE_CHAT_ID)
  console.log('💾 Storage Path:', STORAGE_PATH)
  console.log('---')

  try {
    // Create data folder if it doesn't exist
    console.log('📁 Ensuring data folder exists...')
    await fs.mkdir(STORAGE_PATH, { recursive: true })
    console.log('✅ Data folder ready')
    // Initialize Bale sync service
    const baleSync = new BaleSync(BALE_TOKEN, BALE_CHAT_ID, STORAGE_PATH)

    // Test Bale connection first
    console.log('🔍 Testing Bale connection...')
    const connectionTest = await baleSync.testConnection()

    if (!connectionTest) {
      console.error('❌ Failed to connect to Bale. Please check your token and chat ID.')
      process.exit(1)
    }

    // Start Bale sync service
    await baleSync.start()

    console.log('✅ CaroSync Bale service is running successfully!')
    console.log('📊 Monitoring for new Telegram posts and syncing to Bale...')
    console.log('Press Ctrl+C to stop')
  } catch (error) {
    console.error('❌ Error starting CaroSync Bale service:', error)
    process.exit(1)
  }
})()
