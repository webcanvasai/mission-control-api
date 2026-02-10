import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import path from 'path';

export interface WatcherEvents {
  'ticket:created': (filePath: string) => void;
  'ticket:updated': (filePath: string) => void;
  'ticket:deleted': (filePath: string) => void;
  'error': (error: Error) => void;
  'ready': () => void;
}

export class WatcherService extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private isReady = false;

  /**
   * Start watching the vault directory for ticket file changes
   */
  start(vaultPath: string): void {
    if (this.watcher) {
      console.warn('Watcher already running');
      return;
    }

    console.log(`[Watcher] Setting up watcher for: ${vaultPath}`);
    
    // Watch the entire directory and filter in event handlers
    this.watcher = chokidar.watch(vaultPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 0, // Only watch top-level files
      usePolling: true, // More reliable for network filesystems and some Linux setups
      interval: 500, // Poll interval
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', (filePath) => {
        const basename = path.basename(filePath);
        if (/^TICK-\d+\.md$/.test(basename)) {
          console.log(`[Watcher] Ticket created: ${basename}`);
          this.emit('ticket:created', filePath);
        }
      })
      .on('change', (filePath) => {
        const basename = path.basename(filePath);
        if (/^TICK-\d+\.md$/.test(basename)) {
          console.log(`[Watcher] Ticket updated: ${basename}`);
          this.emit('ticket:updated', filePath);
        }
      })
      .on('unlink', (filePath) => {
        const basename = path.basename(filePath);
        if (/^TICK-\d+\.md$/.test(basename)) {
          console.log(`[Watcher] Ticket deleted: ${basename}`);
          this.emit('ticket:deleted', filePath);
        }
      })
      .on('error', (error) => {
        console.error('[Watcher] Error:', error);
        this.emit('error', error);
      })
      .on('ready', () => {
        this.isReady = true;
        console.log(`[Watcher] Ready. Watching: ${vaultPath}`);
        this.emit('ready');
      });
  }

  /**
   * Stop the watcher
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.isReady = false;
      console.log('[Watcher] Stopped');
    }
  }

  /**
   * Check if watcher is ready
   */
  isWatching(): boolean {
    return this.isReady && this.watcher !== null;
  }
}
