import EitaaSync from './eitaa-sync.js'
import 'dotenv/config'

// Main service that coordinates Telegram monitoring and Eitaa syncing
;(async () => {
  const API_ID = parseInt(process.env.API_ID || '0')
  const API_HASH = process.env.API_HASH || ''
  const SESSION = process.env.SESSION || ''
  const PHONE = process.env.PHONE || ''
  const CHANNEL = process.env.CHANNEL || ''
  const STORAGE_PATH = process.env.STORAGE_PATH || './data'
  const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '5')
  
  // Eitaa configuration
  const EITAA_TOKEN = process.env.EITAA_TOKEN || ''
  const EITAA_CHAT_ID = process.env.EITAA_CHAT_ID || ''

  // Validate required environment variables
  if (!API_ID || !API_HASH || !PHONE || !CHANNEL) {
    console.error('❌ Missing required Telegram environment variables. Please check your .env file.')
    console.error('Required: API_ID, API_HASH, PHONE, CHANNEL')
    process.exit(1)
  }

  if (!EITAA_TOKEN || !EITAA_CHAT_ID) {
    console.error('❌ Missing required Eitaa environment variables. Please check your .env file.')
    console.error('Required: EITAA_TOKEN, EITAA_CHAT_ID')
    process.exit(1)
  }

  console.log('🚀 Starting CaroSync - Telegram to Eitaa Bridge...')
  console.log('📱 Telegram Channel:', CHANNEL)
  console.log('📤 Eitaa Chat:', EITAA_CHAT_ID)
  console.log('💾 Storage Path:', STORAGE_PATH)
  console.log('---')

  try {
    // Initialize Eitaa sync service
    const eitaaSync = new EitaaSync(EITAA_TOKEN, EITAA_CHAT_ID, STORAGE_PATH)
    
    // Test Eitaa connection first
    console.log('🔍 Testing Eitaa connection...')
    const connectionTest = await eitaaSync.testConnection()
    
    if (!connectionTest) {
      console.error('❌ Failed to connect to Eitaa. Please check your token and chat ID.')
      process.exit(1)
    }
    
    // Start Eitaa sync service
    await eitaaSync.start()
    
    console.log('✅ CaroSync is running successfully!')
    console.log('📊 Monitoring for new Telegram posts and syncing to Eitaa...')
    console.log('Press Ctrl+C to stop')
    
  } catch (error) {
    console.error('❌ Error starting CaroSync:', error)
    process.exit(1)
  }
})()