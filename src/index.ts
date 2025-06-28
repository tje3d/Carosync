import fs from 'fs/promises'
import input from 'input'
import path from 'path'
import { TelegramClient } from 'telegram'
import type { Entity } from 'telegram/define'
import { NewMessage, NewMessageEvent } from 'telegram/events'
import { DeletedMessage, DeletedMessageEvent } from 'telegram/events/DeletedMessage'
import { EditedMessage, EditedMessageEvent } from 'telegram/events/EditedMessage'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram/tl'
import 'dotenv/config'

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

class TelegramChannelSync {
  private client: TelegramClient
  private session: StringSession
  private apiId: number
  private apiHash: string
  private storagePath: string
  private mediaGroups: Map<string, Api.Message[]> = new Map()

  constructor(apiId: number, apiHash: string, session: string, storagePath = './data') {
    this.apiId = apiId
    this.apiHash = apiHash
    this.session = new StringSession(session)
    this.storagePath = storagePath
    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
    })
  }

  async start(phoneNumber: string) {
    await this.client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => await input.text('Password (if 2FA enabled): '),
      phoneCode: async () => await input.text('Verification code: '),
      onError: (err) => console.error('Auth error:', err),
    })

    console.log('Session:', this.client.session.save())
    await this.ensureStorage()
    await this.cleanupSyncStatus()
  }

  private async ensureStorage() {
    await fs.mkdir(this.storagePath, { recursive: true })
    await fs.mkdir(path.join(this.storagePath, 'media'), { recursive: true })
  }

  private async cleanupSyncStatus() {
    try {
      const syncStatusFile = path.join(this.storagePath, 'telegram_sync_status.json')
      await fs.unlink(syncStatusFile)
      console.log('🧹 Cleaned up previous sync status')
    } catch (error) {
      // File doesn't exist, which is fine
    }
  }

  async monitorChannel(channelId: string) {
    await this.ensureStorage()

    const channel = (await this.client.getEntity(channelId)) as Entity
    const channelName =
      ('username' in channel ? channel.username : null) ||
      ('title' in channel ? channel.title : 'Unknown')

    // Handler for new messages
    const newMessageHandler = async (event: NewMessageEvent) => {
      const message = event.message
      if (!(message.peerId instanceof Api.PeerChannel)) return

      // Handle media groups (albums)
      if (message.groupedId) {
        await this.handleMediaGroup(message)
      } else {
        await this.processMessage(message)
      }
    }

    // Handler for edited messages
    const editHandler = async (event: EditedMessageEvent) => {
      const message = event.message
      if (!(message.peerId instanceof Api.PeerChannel)) return

      console.log(`Edited post: ${message.id}`)
      await this.processMessage(message)
    }

    // Handler for deleted messages
    const deleteHandler = async (event: DeletedMessageEvent) => {
      if (!event.deletedIds || event.deletedIds.length === 0) return

      for (const deletedId of event.deletedIds) {
        console.log(`Deleted post: ${deletedId}`)
        await this.handleDeletedMessage(deletedId)
      }
    }

    // Handler for pinned messages
    const pinHandler = async (update: Api.TypeUpdate) => {
      // Handle pinned messages through raw updates
      if (update instanceof Api.UpdatePinnedMessages) {
        console.log(`Pinned messages update:`, update.messages)
        // Handle pinned messages
        for (const messageId of update.messages || []) {
          await this.handlePinnedMessageById(messageId, update.peer)
        }
      }
    }

    this.client.addEventHandler(newMessageHandler, new NewMessage({ chats: [channel.id] }))
    this.client.addEventHandler(editHandler, new EditedMessage({ chats: [channel.id] }))
    this.client.addEventHandler(deleteHandler, new DeletedMessage({ chats: [channel.id] }))
    this.client.addEventHandler(pinHandler) // Raw update handler for pinned messages

    console.log(`Monitoring channel: ${channelName}`)
  }

  private async handleMediaGroup(message: Api.Message) {
    const groupId = message.groupedId!.toString()
    let group = this.mediaGroups.get(groupId) || []

    // Add message to group
    group.push(message)
    this.mediaGroups.set(groupId, group)

    // Wait 500ms to collect all group messages
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Check if we have all messages
    const currentGroup = this.mediaGroups.get(groupId) || []
    if (currentGroup.length > 1 && currentGroup[currentGroup.length - 1] === message) {
      // Process entire group
      await this.processMediaGroup(currentGroup)
      this.mediaGroups.delete(groupId)
    }
  }

  private async processMediaGroup(messages: Api.Message[]) {
    // Sort by message ID to maintain order
    messages.sort((a, b) => a.id - b.id)

    const mainMessage = messages[0]
    if (!mainMessage) return

    const postData: PostData = {
      id: `group_${mainMessage.groupedId}`,
      date: mainMessage.date,
      editDate: mainMessage.editDate,
      text: mainMessage.text,
      media: [],
      childMessages: messages.map((m) => m.id),
    }

    // Add reply information if available
    if (mainMessage.replyTo) {
      if (mainMessage.replyTo instanceof Api.MessageReplyHeader) {
        postData.replyToMsgId = mainMessage.replyTo.replyToMsgId
        if (mainMessage.replyTo.replyToTopId) {
          postData.replyToTopId = mainMessage.replyTo.replyToTopId
        }
      }
    }

    // Process all media in the group
    for (const message of messages) {
      if (message.media) {
        const mediaFiles = await this.downloadMedia(message)
        postData.media.push(...mediaFiles)
      }
    }

    await this.savePostData(postData)
    console.log(
      `Processed media group with ${messages.length} items${
        postData.replyToMsgId ? ` (reply to ${postData.replyToMsgId})` : ''
      }`,
    )
  }

  private async processMessage(message: Api.Message) {
    try {
      const postData: PostData = {
        id: message.id,
        date: message.date,
        editDate: message.editDate,
        text: message.text,
        media: [],
      }

      // Add reply information if available
      if (message.replyTo) {
        if (message.replyTo instanceof Api.MessageReplyHeader) {
          postData.replyToMsgId = message.replyTo.replyToMsgId
          if (message.replyTo.replyToTopId) {
            postData.replyToTopId = message.replyTo.replyToTopId
          }
        }
      }

      if (message.media) {
        const mediaFiles = await this.downloadMedia(message)
        postData.media = mediaFiles
      }

      await this.savePostData(postData)
      console.log(
        `Processed message ${message.id}${
          postData.replyToMsgId ? ` (reply to ${postData.replyToMsgId})` : ''
        }`,
      )
    } catch (error) {
      console.error('Error processing message:', error)
    }
  }

  private async downloadMedia(message: Api.Message): Promise<string[]> {
    const mediaDir = path.join(this.storagePath, 'media', message.id.toString())
    await fs.mkdir(mediaDir, { recursive: true })

    const mediaFiles: string[] = []
    const media = message.media
    const messageEditDate = message.editDate || message.date

    // Handle photos
    if (
      media instanceof Api.MessageMediaPhoto &&
      media.photo &&
      !(media.photo instanceof Api.PhotoEmpty)
    ) {
      const filePath = path.join(mediaDir, `photo_${media.photo.id}.jpg`)

      if (await this.shouldDownloadFile(filePath, messageEditDate)) {
        console.log(`📸 Downloading photo for message ${message.id}...`)
        const buffer = await this.downloadWithProgress(media, `photo_${media.photo.id}.jpg`)
        await fs.writeFile(filePath, buffer)
        console.log(`✅ Photo downloaded: ${filePath}`)
      } else {
        console.log(`⏭️  Photo already exists and up-to-date: ${filePath}`)
      }
      mediaFiles.push(filePath)
    }
    // Handle documents (videos, voice, files)
    else if (media instanceof Api.MessageMediaDocument) {
      if (media.document instanceof Api.Document) {
        const fileName = this.getDocumentFilename(media.document)
        const filePath = path.join(mediaDir, fileName)

        if (await this.shouldDownloadFile(filePath, messageEditDate)) {
          console.log(`📄 Downloading ${fileName} for message ${message.id}...`)
          const buffer = await this.downloadWithProgress(media, fileName)
          await fs.writeFile(filePath, buffer)
          console.log(`✅ Document downloaded: ${filePath}`)
        } else {
          console.log(`⏭️  Document already exists and up-to-date: ${filePath}`)
        }
        mediaFiles.push(filePath)
      }
    }
    // Handle web pages with embedded media
    else if (media instanceof Api.MessageMediaWebPage) {
      if (
        media.webpage instanceof Api.WebPage &&
        media.webpage.photo &&
        !(media.webpage.photo instanceof Api.PhotoEmpty)
      ) {
        const filePath = path.join(mediaDir, `webpage_photo_${media.webpage.photo.id}.jpg`)

        if (await this.shouldDownloadFile(filePath, messageEditDate)) {
          console.log(`🌐 Downloading webpage photo for message ${message.id}...`)
          const buffer = await this.downloadWithProgress(
            media,
            `webpage_photo_${media.webpage.photo.id}.jpg`,
          )
          await fs.writeFile(filePath, buffer)
          console.log(`✅ Webpage photo downloaded: ${filePath}`)
        } else {
          console.log(`⏭️  Webpage photo already exists and up-to-date: ${filePath}`)
        }
        mediaFiles.push(filePath)
      }
    }

    return mediaFiles
  }

  private async downloadWithProgress(media: any, fileName: string): Promise<Buffer> {
    let downloadedBytes = 0
    let totalBytes = 0
    let lastProgressTime = Date.now()

    const buffer = (await this.client.downloadMedia(media, {
      progressCallback: (downloaded: any, total: any) => {
        // Convert BigInteger to number
        downloadedBytes = typeof downloaded === 'bigint' ? Number(downloaded) : downloaded
        totalBytes = typeof total === 'bigint' ? Number(total) : total

        // Update progress every 500ms to avoid spam
        const now = Date.now()
        if (now - lastProgressTime > 500) {
          const percentage = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2)
          const totalMB = (totalBytes / (1024 * 1024)).toFixed(2)

          process.stdout.write(`\r⬇️  ${fileName}: ${percentage}% (${downloadedMB}/${totalMB} MB)`)
          lastProgressTime = now
        }
      },
    })) as Buffer

    // Clear progress line and show completion
    if (totalBytes > 0) {
      const totalMB = (totalBytes / (1024 * 1024)).toFixed(2)
      process.stdout.write(`\r⬇️  ${fileName}: 100% (${totalMB}/${totalMB} MB) ✅\n`)
    }

    return buffer
  }

  private async shouldDownloadFile(filePath: string, messageEditDate: number): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath)
      const fileModTime = Math.floor(stats.mtime.getTime() / 1000) // Convert to Unix timestamp

      // If message was edited after the file was last modified, re-download
      return messageEditDate > fileModTime
    } catch (error) {
      // File doesn't exist, so we should download it
      return true
    }
  }

  private getDocumentFilename(document: Api.Document): string {
    // Try to get filename from attributes
    for (const attribute of document.attributes) {
      if (attribute instanceof Api.DocumentAttributeFilename) {
        return attribute.fileName
      }
    }

    // Generate filename based on media type
    for (const attribute of document.attributes) {
      if (attribute instanceof Api.DocumentAttributeVideo) {
        return `video_${document.id}.mp4`
      }
      if (attribute instanceof Api.DocumentAttributeAudio) {
        return attribute.voice ? `voice_${document.id}.ogg` : `audio_${document.id}.mp3`
      }
      if (attribute instanceof Api.DocumentAttributeAnimated) {
        return `animation_${document.id}.mp4`
      }
      if (attribute instanceof Api.DocumentAttributeSticker) {
        return `sticker_${document.id}.webp`
      }
    }

    // Default filename
    return `document_${document.id}.bin`
  }

  private async savePostData(data: PostData) {
    const filePath = path.join(this.storagePath, `post_${data.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(data, null, 2))
    console.log(`Saved post data: ${filePath}`)
  }

  private async getExistingPostData(postId: string | number): Promise<PostData | null> {
    try {
      const filePath = path.join(this.storagePath, `post_${postId}.json`)
      const data = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(data) as PostData
    } catch (error) {
      return null // File doesn't exist or can't be read
    }
  }

  private async handleDeletedMessage(messageId: number) {
    try {
      const existingPost = await this.getExistingPostData(messageId)
      if (existingPost) {
        // Mark as deleted
        existingPost.deleted = true
        await this.savePostData(existingPost)
        console.log(`Marked post ${messageId} as deleted`)
      }

      // Also check for media groups that might contain this message
      const mediaDir = path.join(this.storagePath, 'media', messageId.toString())
      try {
        await fs.rm(mediaDir, { recursive: true, force: true })
        console.log(`Removed media directory for deleted message: ${messageId}`)
      } catch (error) {
        // Directory might not exist, which is fine
      }
    } catch (error) {
      console.error(`Error handling deleted message ${messageId}:`, error)
    }
  }

  private async handlePinnedMessageById(messageId: number, peer: Api.TypePeer) {
    try {
      // Check if this is a channel update
      if (!(peer instanceof Api.PeerChannel)) return

      const existingPost = await this.getExistingPostData(messageId)
      if (existingPost) {
        // Update pinned status
        existingPost.pinned = true
        existingPost.pinnedDate = Math.floor(Date.now() / 1000)
        await this.savePostData(existingPost)
        console.log(`Marked post ${messageId} as pinned`)
      } else {
        // Try to fetch the message and process it
        try {
          const messages = await this.client.getMessages(peer, { ids: [messageId] })
          if (messages.length > 0 && messages[0]) {
            await this.processMessage(messages[0])
            const postData = await this.getExistingPostData(messageId)
            if (postData) {
              postData.pinned = true
              postData.pinnedDate = Math.floor(Date.now() / 1000)
              await this.savePostData(postData)
            }
          }
        } catch (fetchError) {
          console.error(`Could not fetch message ${messageId} for pinning:`, fetchError)
        }
      }
    } catch (error) {
      console.error(`Error handling pinned message ${messageId}:`, error)
    }
  }

  private hasPostChanged(existing: PostData, current: PostData): boolean {
    return (
      existing.editDate !== current.editDate
      // existing.text !== current.text ||
      // existing.media.length !== current.media.length ||
      // existing.replyToMsgId !== current.replyToMsgId ||
      // existing.replyToTopId !== current.replyToTopId
    )
  }

  async syncLatestPosts(channelId: string, limit: number = 15) {
    await this.ensureStorage()
    
    // Create sync status file to signal that Telegram sync is in progress
    const syncStatusFile = path.join(this.storagePath, 'telegram_sync_status.json')
    await fs.writeFile(syncStatusFile, JSON.stringify({ 
      status: 'in_progress', 
      startTime: Date.now(),
      limit: limit 
    }, null, 2))

    const channel = (await this.client.getEntity(channelId)) as Entity
    const channelName =
      ('username' in channel ? channel.username : null) ||
      ('title' in channel ? channel.title : 'Unknown')

    console.log(`Syncing latest ${limit} posts from channel: ${channelName}`)

    try {
      // Get latest messages from the channel
      const messages = await this.client.getMessages(channel, {
        limit: limit,
        reverse: false, // Get latest messages first
      })

      console.log(`Found ${messages.length} messages to check`)

      let newPosts = 0
      let updatedPosts = 0
      let skippedPosts = 0

      for (const message of messages) {
        if (!message || typeof message.id === 'undefined') continue

        // Check if this is a media group message
        if (message.groupedId) {
          const groupId = `group_${message.groupedId}`
          const existingGroup = await this.getExistingPostData(groupId)

          if (!existingGroup) {
            // New media group - collect all messages in this group
            const groupMessages = messages.filter(
              (m) => m.groupedId?.toString() === message.groupedId?.toString(),
            )
            if (groupMessages.length > 0) {
              await this.processMediaGroup(groupMessages)
              newPosts++
            }
          } else {
            // Check if group was edited
            const currentGroupData: PostData = {
              id: groupId,
              date: message.date,
              editDate: message.editDate,
              text: message.text,
              media: [],
              childMessages: [message.id],
            }

            // Add reply information if available
            if (message.replyTo && message.replyTo instanceof Api.MessageReplyHeader) {
              currentGroupData.replyToMsgId = message.replyTo.replyToMsgId
              if (message.replyTo.replyToTopId) {
                currentGroupData.replyToTopId = message.replyTo.replyToTopId
              }
            }

            if (this.hasPostChanged(existingGroup, currentGroupData)) {
              const groupMessages = messages.filter(
                (m) => m.groupedId?.toString() === message.groupedId?.toString(),
              )
              await this.processMediaGroup(groupMessages)
              updatedPosts++
              console.log(`Updated media group: ${groupId}`)
            } else {
              skippedPosts++
            }
          }
        } else {
          // Regular message
          const existingPost = await this.getExistingPostData(message.id)

          if (!existingPost) {
            // New post
            await this.processMessage(message)
            newPosts++
          } else {
            // Check if post was edited
            const currentPostData: PostData = {
              id: message.id,
              date: message.date,
              editDate: message.editDate,
              text: message.text,
              media: [],
            }

            // Add reply information if available
            if (message.replyTo && message.replyTo instanceof Api.MessageReplyHeader) {
              currentPostData.replyToMsgId = message.replyTo.replyToMsgId
              if (message.replyTo.replyToTopId) {
                currentPostData.replyToTopId = message.replyTo.replyToTopId
              }
            }

            if (this.hasPostChanged(existingPost, currentPostData)) {
              await this.processMessage(message)
              updatedPosts++
              console.log(`Updated post: ${message.id}`)
            } else {
              skippedPosts++
            }
          }
        }
      }

      console.log(
        `Sync completed: ${newPosts} new posts, ${updatedPosts} updated posts, ${skippedPosts} skipped posts`,
      )
      
      // Mark sync as completed
      await fs.writeFile(syncStatusFile, JSON.stringify({ 
        status: 'completed', 
        endTime: Date.now(),
        newPosts,
        updatedPosts,
        skippedPosts 
      }, null, 2))
      
    } catch (error) {
      console.error('Error syncing latest posts:', error)
      
      // Mark sync as failed
      await fs.writeFile(syncStatusFile, JSON.stringify({ 
        status: 'failed', 
        endTime: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, null, 2))
    }
  }
}

// Usage
;(async () => {
  const API_ID = parseInt(process.env.API_ID || '0')
  const API_HASH = process.env.API_HASH || ''
  const SESSION = process.env.SESSION || ''
  const PHONE = process.env.PHONE || ''
  const CHANNEL = process.env.CHANNEL || ''
  const STORAGE_PATH = process.env.STORAGE_PATH || './data'
  const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '5')
  
  // Eitaa configuration (optional)
  const EITAA_TOKEN = process.env.EITAA_TOKEN || ''
  const EITAA_CHAT_ID = process.env.EITAA_CHAT_ID || ''

  // Validate required environment variables
  if (!API_ID || !API_HASH || !PHONE || !CHANNEL) {
    console.error('❌ Missing required Telegram environment variables. Please check your .env file.')
    console.error('Required: API_ID, API_HASH, PHONE, CHANNEL')
    process.exit(1)
  }

  const sync = new TelegramChannelSync(API_ID, API_HASH, SESSION, STORAGE_PATH)
  await sync.start(PHONE)

  console.log('🚀 Starting CaroSync - Telegram Channel Sync...')
  
  // Start monitoring for new posts immediately (non-blocking)
  const monitoringPromise = sync.monitorChannel(CHANNEL)

  // Sync latest posts first
  console.log(`📥 Syncing latest ${SYNC_LIMIT} posts...`)
  await sync.syncLatestPosts(CHANNEL, SYNC_LIMIT)

  console.log('✅ Initial Telegram sync completed!')

  // Initialize Eitaa sync if configured (after Telegram sync is done)
  let eitaaSync: any = null
  if (EITAA_TOKEN && EITAA_CHAT_ID) {
    console.log('📤 Eitaa integration enabled')
    try {
      const { default: EitaaSync } = await import('./eitaa-sync.js')
      eitaaSync = new EitaaSync(EITAA_TOKEN, EITAA_CHAT_ID, STORAGE_PATH)
      
      // Test Eitaa connection
      const connectionTest = await eitaaSync.testConnection()
      if (connectionTest) {
        console.log('✅ Eitaa connection successful')
        // Start Eitaa sync service (this will wait for any ongoing Telegram sync)
        eitaaSync.start()
      } else {
        console.warn('⚠️  Eitaa connection failed, continuing with Telegram-only mode')
        eitaaSync = null
      }
    } catch (error) {
      console.warn('⚠️  Eitaa integration error:', error)
      console.warn('⚠️  Continuing with Telegram-only mode')
    }
  } else {
    console.log('📱 Running in Telegram-only mode (Eitaa not configured)')
  }

  console.log('👀 Now monitoring for real-time updates...')
  if (eitaaSync) {
    console.log('📤 Auto-syncing to Eitaa enabled')
  }
  console.log('Press Ctrl+C to stop')

  // Wait for monitoring to complete (it runs indefinitely)
  await monitoringPromise
})()
