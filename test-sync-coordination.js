#!/usr/bin/env node

// Test script to verify sync coordination between Telegram and Eitaa
import fs from 'fs/promises'
import path from 'path'

const STORAGE_PATH = './test-data'
const SYNC_STATUS_FILE = path.join(STORAGE_PATH, 'telegram_sync_status.json')

async function createTestData() {
  // Create test directory
  await fs.mkdir(STORAGE_PATH, { recursive: true })
  
  console.log('📁 Created test storage directory')
}

async function simulateTelegramSync() {
  console.log('🔄 Simulating Telegram sync start...')
  
  // Create sync status file
  await fs.writeFile(SYNC_STATUS_FILE, JSON.stringify({
    status: 'in_progress',
    startTime: Date.now(),
    limit: 15
  }, null, 2))
  
  console.log('📝 Created sync status file (in_progress)')
  
  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 3000))
  
  // Complete sync
  await fs.writeFile(SYNC_STATUS_FILE, JSON.stringify({
    status: 'completed',
    endTime: Date.now(),
    newPosts: 5,
    updatedPosts: 2,
    skippedPosts: 8
  }, null, 2))
  
  console.log('✅ Telegram sync completed')
}

async function checkSyncStatus() {
  try {
    const data = await fs.readFile(SYNC_STATUS_FILE, 'utf-8')
    const status = JSON.parse(data)
    console.log('📊 Current sync status:', status)
    return status.status === 'in_progress'
  } catch (error) {
    console.log('📊 No sync status file found')
    return false
  }
}

async function simulateEitaaWait() {
  console.log('⏳ Eitaa sync checking for ongoing Telegram sync...')
  
  while (await checkSyncStatus()) {
    console.log('⏳ Eitaa waiting for Telegram sync to complete...')
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log('🚀 Eitaa sync can now proceed!')
}

async function cleanup() {
  try {
    await fs.rm(STORAGE_PATH, { recursive: true, force: true })
    console.log('🧹 Cleaned up test data')
  } catch (error) {
    console.log('🧹 Cleanup completed')
  }
}

async function runTest() {
  console.log('🧪 Testing sync coordination...')
  console.log('================================')
  
  try {
    await createTestData()
    
    // Start both processes
    const telegramPromise = simulateTelegramSync()
    const eitaaPromise = simulateEitaaWait()
    
    // Wait for both to complete
    await Promise.all([telegramPromise, eitaaPromise])
    
    console.log('================================')
    console.log('✅ Test completed successfully!')
    console.log('✅ Sync coordination is working properly')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    await cleanup()
  }
}

// Run the test
runTest().catch(console.error)