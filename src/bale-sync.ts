import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'

interface BaleResponse {
  ok: boolean
  result?: any
  error?: string
  description?: string
  error_code?: number
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

interface ProcessedPostMetadata {
  date?: number
  editDate?: number
  deleted?: boolean
  baleMessageId?: number // Store Bale message ID for edits/deletes
}

class BaleSync {
  private token: string
  private chatId: string
  private baseUrl: string
  private storagePath: string
  private processedPosts: Map<string, ProcessedPostMetadata> = new Map()

  constructor(token: string, chatId: string, storagePath = './data') {
    this.token = token
    this.chatId = chatId
    this.baseUrl = `https://tapi.bale.ai/bot${token}`
    this.storagePath = storagePath
  }

  async start() {
    console.log('🚀 Starting Bale Sync Service...')
    await this.loadProcessedPosts()

    // Wait for any ongoing Telegram sync to complete before starting
    await this.waitForTelegramSync()

    await this.syncExistingPosts()
    this.startWatching()
  }

  private async loadProcessedPosts() {
    try {
      const processedFile = path.join(this.storagePath, 'bale_processed.json')
      const data = await fs.readFile(processedFile, 'utf-8')
      const processed = JSON.parse(data) as Record<string, ProcessedPostMetadata>
      this.processedPosts = new Map(Object.entries(processed))
      console.log(`📋 Loaded ${this.processedPosts.size} processed posts`)
    } catch (error) {
      console.log('📋 No processed posts file found, starting fresh')
    }
  }

  private async saveProcessedPosts() {
    try {
      const processedFile = path.join(this.storagePath, 'bale_processed.json')
      const processedObj = Object.fromEntries(this.processedPosts)
      await fs.writeFile(processedFile, JSON.stringify(processedObj, null, 2))
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

        for (const postData of newPosts) {
          if (!postData) continue

          const postId = postData.id.toString()
          const cachedMetadata = this.processedPosts.get(postId)

          if (!cachedMetadata) {
            // New post - sync if not deleted
            if (!postData.deleted) {
              console.log(
                `🆕 New post detected: ${postData.id} (date: ${new Date(
                  postData.date! * 1000,
                ).toISOString()})`,
              )
              await this.syncPost(postData)
              await new Promise((resolve) => setTimeout(resolve, 1000)) // Rate limiting
            } else {
              // New but already deleted post - just mark as processed
              this.processedPosts.set(postId, {
                date: postData.date,
                editDate: postData.editDate,
                deleted: postData.deleted,
              })
              await this.saveProcessedPosts()
              await this.deletePostData(postData)
            }
          } else {
            // Existing post - check for changes
            const hasChanges =
              cachedMetadata.editDate !== postData.editDate ||
              cachedMetadata.deleted !== postData.deleted

            if (hasChanges) {
              if (postData.deleted && !cachedMetadata.deleted) {
                // Post was deleted
                console.log(`🗑️ Post ${postData.id} was deleted - sending delete request`)
                await this.deleteMessage(cachedMetadata.baleMessageId)

                // Update metadata and remove post data
                this.processedPosts.set(postId, {
                  date: postData.date,
                  editDate: postData.editDate,
                  deleted: postData.deleted,
                  baleMessageId: cachedMetadata.baleMessageId,
                })
                await this.saveProcessedPosts()
                await this.deletePostData(postData)
              } else if (postData.editDate !== cachedMetadata.editDate && !postData.deleted) {
                // Post was edited
                console.log(
                  `✏️ Post ${postData.id} was edited - sending edit request for id: ${cachedMetadata.baleMessageId}`,
                )
                // await this.editMessage(cachedMetadata.baleMessageId, postData.text)

                // Update metadata and remove post data
                this.processedPosts.set(postId, {
                  date: postData.date,
                  editDate: postData.editDate,
                  deleted: postData.deleted,
                  baleMessageId: cachedMetadata.baleMessageId,
                })
                await this.saveProcessedPosts()
                await this.deletePostData(postData)
              }
            } else {
              // No changes - just remove post data
              await this.deletePostData(postData)
            }
          }
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
      console.log('\n🛑 Shutting down Bale sync...')
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
      console.log(`📤 Syncing post ${postData.id} to Bale...`)

      let baleMessageId: number | undefined

      if (postData.media && postData.media.length > 0) {
        // Send media files
        for (const mediaPath of postData.media) {
          const result = await this.sendFile(mediaPath, postData.text, postData.pinned)
          if (result.ok && result.result) {
            baleMessageId = result.result.message_id
          }
          await new Promise((resolve) => setTimeout(resolve, 500)) // Small delay between files
        }
      } else if (postData.text) {
        // Send text message
        const result = await this.sendMessage(postData.text, postData.pinned)
        if (result.ok && result.result) {
          baleMessageId = result.result.message_id
        }
      }

      this.processedPosts.set(postData.id.toString(), {
        date: postData.date,
        editDate: postData.editDate,
        deleted: postData.deleted,
        baleMessageId: baleMessageId,
      })
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

  private async sendMessage(text: string, pin?: boolean): Promise<BaleResponse> {
    const url = `${this.baseUrl}/sendMessage`

    const payload = {
      chat_id: this.chatId,
      text: text,
      ...(pin && { pin: true }),
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const result = (await response.json()) as BaleResponse

      if (!result.ok) {
        throw new Error(`Bale API error: ${result.description || result.error || 'Unknown error'}`)
      }

      console.log('📨 Message sent successfully')
      return result
    } catch (error) {
      console.error('❌ Error sending message:', error)
      throw error
    }
  }

  private getFileType(filePath: string): 'photo' | 'video' | 'audio' | 'document' {
    const ext = path.extname(filePath).toLowerCase()

    // Image formats
    const imageFormats = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
    if (imageFormats.includes(ext)) {
      return 'photo'
    }

    // Video formats
    const videoFormats = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v']
    if (videoFormats.includes(ext)) {
      return 'video'
    }

    // Audio formats
    const audioFormats = ['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.wma']
    if (audioFormats.includes(ext)) {
      return 'audio'
    }

    // Default to document for everything else
    return 'document'
  }

  private async sendFile(filePath: string, caption?: string, pin?: boolean): Promise<BaleResponse> {
    try {
      // Check if file exists
      await fs.access(filePath)

      const fileBuffer = await fs.readFile(filePath)
      const fileName = path.basename(filePath)
      const fileType = this.getFileType(filePath)

      let url: string
      let fileFieldName: string
      let emoji: string

      // Determine API endpoint and field name based on file type
      switch (fileType) {
        case 'photo':
          url = `${this.baseUrl}/sendPhoto`
          fileFieldName = 'photo'
          emoji = '🖼️'
          break
        case 'video':
          url = `${this.baseUrl}/sendVideo`
          fileFieldName = 'video'
          emoji = '🎥'
          break
        case 'audio':
          url = `${this.baseUrl}/sendAudio`
          fileFieldName = 'audio'
          emoji = '🎵'
          break
        default:
          url = `${this.baseUrl}/sendDocument`
          fileFieldName = 'document'
          emoji = '📎'
      }

      const formData = new FormData()
      formData.append('chat_id', this.chatId)
      formData.append(fileFieldName, new Blob([fileBuffer]), fileName)

      if (caption) {
        formData.append('caption', caption)
      }

      if (pin) {
        formData.append('pin', 'true')
      }

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      })

      const result = (await response.json()) as BaleResponse

      if (!result.ok) {
        throw new Error(`Bale API error: ${result.description || result.error || 'Unknown error'}`)
      }

      console.log(
        `${emoji} ${
          fileType.charAt(0).toUpperCase() + fileType.slice(1)
        } sent successfully: ${fileName}`,
      )
      return result
    } catch (error) {
      console.error(`❌ Error sending file ${filePath}:`, error)
      throw error
    }
  }

  private async editMessage(messageId?: number, newText?: string): Promise<BaleResponse | null> {
    if (!messageId || !newText) {
      console.warn('⚠️ Cannot edit message: missing message ID or text')
      return null
    }

    const url = `${this.baseUrl}/editMessageText`

    const payload = {
      chat_id: this.chatId,
      message_id: messageId,
      text: newText,
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const result = (await response.json()) as BaleResponse

      if (!result.ok) {
        throw new Error(`Bale API error: ${result.description || result.error || 'Unknown error'}`)
      }

      console.log(`✏️ Message ${messageId} edited successfully`)
      return result
    } catch (error) {
      console.error(`❌ Error editing message ${messageId}:`, error)
      throw error
    }
  }

  private async deleteMessage(messageId?: number): Promise<BaleResponse | null> {
    if (!messageId) {
      console.warn('⚠️ Cannot delete message: missing message ID')
      return null
    }

    const url = `${this.baseUrl}/deleteMessage`

    const payload = {
      chat_id: this.chatId,
      message_id: messageId,
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const result = (await response.json()) as BaleResponse

      if (!result.ok) {
        throw new Error(`Bale API error: ${result.description || result.error || 'Unknown error'}`)
      }

      console.log(`🗑️ Message ${messageId} deleted successfully`)
      return result
    } catch (error) {
      console.error(`❌ Error deleting message ${messageId}:`, error)
      throw error
    }
  }

  private async deletePostData(postData: PostData) {
    try {
      // Delete post JSON file only (keep media for potential re-sync)
      const postFilePath = path.join(this.storagePath, `post_${postData.id}.json`)
      try {
        await fs.unlink(postFilePath)
        console.log(`🗑️ Deleted post file: post_${postData.id}.json`)
      } catch (error) {
        console.warn(`⚠️ Could not delete post file ${postFilePath}:`, error)
      }
    } catch (error) {
      console.error(`❌ Error deleting post data ${postData.id}:`, error)
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
        console.warn('⚠️  Telegram sync taking too long, proceeding with Bale sync anyway')
        break
      }

      console.log('⏳ Waiting for Telegram sync to complete...')
      await new Promise((resolve) => setTimeout(resolve, 2000)) // Check every 2 seconds
    }

    console.log('✅ Telegram sync completed, proceeding with Bale sync')
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
      const result = (await response.json()) as BaleResponse

      if (result.ok) {
        console.log('✅ Bale connection test successful')
        console.log('Bot info:', result.result)
        return true
      } else {
        console.error('❌ Bale connection test failed:', result.description || result.error)
        return false
      }
    } catch (error) {
      console.error('❌ Bale connection test error:', error)
      return false
    }
  }
}

export default BaleSync
