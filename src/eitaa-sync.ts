import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'

interface EitaaResponse {
  ok: boolean
  result?: any
  error?: string
}

interface PostData {
  id: string | number
  date?: number
  editDate?: number
  text?: string
  media: string[]
  childMessages?: number[]
  replyToMsgId?: number
  replyToTopId?: number
  deleted?: boolean
  pinned?: boolean
  pinnedDate?: number
}

class EitaaSync {
  private token: string
  private chatId: string
  private baseUrl: string
  private storagePath: string
  private processedPosts: Set<string> = new Set()

  constructor(token: string, chatId: string, storagePath = './data') {
    this.token = token
    this.chatId = chatId
    this.baseUrl = `https://eitaayar.ir/api/${token}`
    this.storagePath = storagePath
  }

  async start() {
    console.log('🚀 Starting Eitaa Sync Service...')
    await this.loadProcessedPosts()
    
    // Wait for any ongoing Telegram sync to complete before starting
    await this.waitForTelegramSync()
    
    await this.syncExistingPosts()
    this.startWatching()
  }

  private async loadProcessedPosts() {
    try {
      const processedFile = path.join(this.storagePath, 'eitaa_processed.json')
      const data = await fs.readFile(processedFile, 'utf-8')
      const processed = JSON.parse(data) as string[]
      this.processedPosts = new Set(processed)
      console.log(`📋 Loaded ${this.processedPosts.size} processed posts`)
    } catch (error) {
      console.log('📋 No processed posts file found, starting fresh')
    }
  }

  private async saveProcessedPosts() {
    try {
      const processedFile = path.join(this.storagePath, 'eitaa_processed.json')
      await fs.writeFile(processedFile, JSON.stringify(Array.from(this.processedPosts), null, 2))
    } catch (error) {
      console.error('❌ Error saving processed posts:', error)
    }
  }

  private async syncExistingPosts() {
    try {
      const files = await fs.readdir(this.storagePath)
      const postFiles = files.filter((file) => file.startsWith('post_') && file.endsWith('.json'))

      console.log(`📦 Found ${postFiles.length} posts to check for sync`)

      // Load all posts and sort by date
      const postsToSync = await this.loadAndSortPosts(postFiles)

      for (const postData of postsToSync) {
        if (postData && !postData.deleted && !this.processedPosts.has(postData.id.toString())) {
          await this.syncPost(postData)
          await new Promise((resolve) => setTimeout(resolve, 1000)) // Rate limiting
        }
      }
    } catch (error) {
      console.error('❌ Error syncing existing posts:', error)
      throw error // Re-throw to stop the entire process
    }
  }

  private startWatching() {
    console.log('👀 Starting to watch for new posts...')

    // Watch for new post files
    const watchInterval = setInterval(async () => {
      try {
        // Check if Telegram sync is in progress before processing
        const isTelegramSyncing = await this.isTelegramSyncInProgress()
        if (isTelegramSyncing) {
          console.log('⏳ Telegram sync in progress, waiting...')
          return
        }
        
        const files = await fs.readdir(this.storagePath)
        const postFiles = files.filter((file) => file.startsWith('post_') && file.endsWith('.json'))

        // Load and sort new posts by date
        const newPosts = await this.loadAndSortPosts(postFiles)
        const unprocessedPosts = newPosts.filter(
          (postData) =>
            postData && !postData.deleted && !this.processedPosts.has(postData.id.toString()),
        )

        for (const postData of unprocessedPosts) {
          console.log(
            `🆕 New post detected: ${postData.id} (date: ${new Date(
              postData.date! * 1000,
            ).toISOString()})`,
          )
          await this.syncPost(postData)
          await new Promise((resolve) => setTimeout(resolve, 1000)) // Rate limiting
        }
      } catch (error) {
        console.error('❌ Error watching for new posts:', error)
        console.error('🛑 Stopping sync process to preserve message order')
        clearInterval(watchInterval)
        await this.saveProcessedPosts()
        process.exit(1) // Exit with error code
      }
    }, 5000) // Check every 5 seconds

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down Eitaa sync...')
      clearInterval(watchInterval)
      this.saveProcessedPosts()
      process.exit(0)
    })
  }

  private async loadPostData(filePath: string): Promise<PostData | null> {
    try {
      const data = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(data) as PostData
    } catch (error) {
      return null
    }
  }

  private async loadAndSortPosts(postFiles: string[]): Promise<PostData[]> {
    const posts: PostData[] = []

    // Load all posts
    for (const file of postFiles) {
      const postData = await this.loadPostData(path.join(this.storagePath, file))
      if (postData) {
        posts.push(postData)
      }
    }

    // Sort by date (oldest first)
    return posts.sort((a, b) => {
      const dateA = a.date || 0
      const dateB = b.date || 0
      return dateA - dateB
    })
  }

  private async syncPost(postData: PostData) {
    try {
      console.log(`📤 Syncing post ${postData.id} to Eitaa...`)

      if (postData.media && postData.media.length > 0) {
        // Send media files
        for (const mediaPath of postData.media) {
          await this.sendFile(mediaPath, postData.text, postData.pinned)
          await new Promise((resolve) => setTimeout(resolve, 500)) // Small delay between files
        }
      } else if (postData.text) {
        // Send text message
        await this.sendMessage(postData.text, postData.pinned)
      }

      this.processedPosts.add(postData.id.toString())
      await this.saveProcessedPosts()
      console.log(`✅ Successfully synced post ${postData.id}`)

      // Delete post and its media after successful sync
      await this.deletePostAndMedia(postData)
    } catch (error) {
      console.error(`❌ Error syncing post ${postData.id}:`, error)
      console.error('🛑 Stopping sync process to preserve message order')
      throw error // Re-throw to stop the entire process
    }
  }

  private async sendMessage(text: string, pin?: boolean): Promise<EitaaResponse> {
    const url = `${this.baseUrl}/sendMessage`

    const formData = new FormData()
    formData.append('chat_id', this.chatId)
    formData.append('text', text)

    if (pin) {
      formData.append('pin', '1')
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      })

      const result = (await response.json()) as EitaaResponse

      if (!result.ok) {
        throw new Error(`Eitaa API error: ${result.error || 'Unknown error'}`)
      }

      console.log('📨 Message sent successfully')
      return result
    } catch (error) {
      console.error('❌ Error sending message:', error)
      throw error
    }
  }

  private async sendFile(
    filePath: string,
    caption?: string,
    pin?: boolean,
  ): Promise<EitaaResponse> {
    const url = `${this.baseUrl}/sendFile`

    try {
      // Check if file exists
      await fs.access(filePath)

      const fileBuffer = await fs.readFile(filePath)
      const fileName = path.basename(filePath)

      const formData = new FormData()
      formData.append('chat_id', this.chatId)
      formData.append('file', new Blob([fileBuffer]), fileName)

      if (caption) {
        formData.append('caption', caption)
      }

      if (pin) {
        formData.append('pin', '1')
      }

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      })

      const result = (await response.json()) as EitaaResponse

      if (!result.ok) {
        throw new Error(`Eitaa API error: ${result.error || 'Unknown error'}`)
      }

      console.log(`📎 File sent successfully: ${fileName}`)
      return result
    } catch (error) {
      console.error(`❌ Error sending file ${filePath}:`, error)
      throw error
    }
  }

  private async deletePostAndMedia(postData: PostData) {
    try {
      console.log(`🗑️ Deleting post ${postData.id} and its media...`)

      // Delete media files
      if (postData.media && postData.media.length > 0) {
        for (const mediaPath of postData.media) {
          try {
            await fs.unlink(mediaPath)
            console.log(`🗑️ Deleted media file: ${path.basename(mediaPath)}`)
          } catch (error) {
            console.warn(`⚠️ Could not delete media file ${mediaPath}:`, error)
          }
        }
      }

      // Delete post JSON file
      const postFilePath = path.join(this.storagePath, `post_${postData.id}.json`)
      try {
        await fs.unlink(postFilePath)
        console.log(`🗑️ Deleted post file: post_${postData.id}.json`)
      } catch (error) {
        console.warn(`⚠️ Could not delete post file ${postFilePath}:`, error)
      }

      console.log(`✅ Successfully deleted post ${postData.id} and its media`)
    } catch (error) {
      console.error(`❌ Error deleting post ${postData.id} and its media:`, error)
    }
  }

  private async waitForTelegramSync(): Promise<void> {
    console.log('🔍 Checking for ongoing Telegram sync...')
    
    const maxWaitTime = 5 * 60 * 1000 // 5 minutes maximum wait time
    const startTime = Date.now()
    
    while (await this.isTelegramSyncInProgress()) {
      if (Date.now() - startTime > maxWaitTime) {
        console.warn('⚠️  Telegram sync taking too long, proceeding with Eitaa sync anyway')
        break
      }
      
      console.log('⏳ Waiting for Telegram sync to complete...')
      await new Promise(resolve => setTimeout(resolve, 2000)) // Check every 2 seconds
    }
    
    console.log('✅ Telegram sync completed, proceeding with Eitaa sync')
  }
  
  private async isTelegramSyncInProgress(): Promise<boolean> {
    try {
      const syncStatusFile = path.join(this.storagePath, 'telegram_sync_status.json')
      const data = await fs.readFile(syncStatusFile, 'utf-8')
      const status = JSON.parse(data)
      
      return status.status === 'in_progress'
    } catch (error) {
      // If file doesn't exist or can't be read, assume no sync is in progress
      return false
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/getMe`
      const response = await fetch(url)
      const result = (await response.json()) as EitaaResponse

      if (result.ok) {
        console.log('✅ Eitaa connection test successful')
        console.log('Bot info:', result.result)
        return true
      } else {
        console.error('❌ Eitaa connection test failed:', result.error)
        return false
      }
    } catch (error) {
      console.error('❌ Eitaa connection test error:', error)
      return false
    }
  }
}

export default EitaaSync
