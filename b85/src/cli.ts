#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { TrackerServer } from './tracker';
import { P2PClient } from './client';
import { formatBytes, formatSpeed } from './utils';
import { TransferStats } from './types';

const program = new Command();

program
  .name('p2pfd')
  .description('P2P文件分发工具，支持Tracker+DHT混合寻址，内网优化')
  .version('1.0.0');

program
  .command('tracker')
  .description('启动Tracker服务器')
  .option('-p, --port <number>', '端口号', '8080')
  .action(async (options) => {
    const port = parseInt(options.port);
    const tracker = new TrackerServer(port);
    await tracker.start();
    console.log(chalk.green(`Tracker服务器已启动，监听端口 ${port}`));
    console.log(chalk.gray('按 Ctrl+C 停止服务器'));
  });

program
  .command('seed')
  .description('做种并分享文件')
  .argument('<file>', '要分享的文件路径')
  .option('-t, --tracker <url>', 'Tracker服务器URL', 'http://localhost:8080')
  .option('-p, --peer-port <number>', 'P2P端口', '6882')
  .option('-d, --dht-port <number>', 'DHT端口', '6881')
  .option('--no-encrypt', '禁用传输加密')
  .action(async (file, options) => {
    const peerPort = parseInt(options.peerPort);
    const dhtPort = parseInt(options.dhtPort);
    const trackerUrl = options.tracker;
    const encrypt = options.encrypt !== false;

    const client = new P2PClient(peerPort, dhtPort);
    await client.start();

    console.log(chalk.blue('正在创建种子文件...'));
    if (encrypt) {
      console.log(chalk.blue('使用AES-256-GCM加密传输'));
    }
    const torrent = await client.createTorrent(file, [trackerUrl], encrypt);
    
    console.log(chalk.green('种子文件创建成功！'));
    console.log(chalk.gray(`Info Hash: ${torrent.infoHash}`));
    console.log(chalk.gray(`文件名: ${torrent.metadata.fileName}`));
    console.log(chalk.gray(`文件大小: ${formatBytes(torrent.metadata.fileSize)}`));
    console.log(chalk.gray(`块数量: ${torrent.metadata.chunkCount}`));
    console.log(chalk.gray(`加密: ${torrent.encryptedAESKey ? '启用 (AES-256-GCM)' : '禁用'}`));
    console.log(chalk.gray(`种子文件: ${file}.torrent`));
    console.log(chalk.green('\n开始做种中... 按 Ctrl+C 停止'));
  });

program
  .command('download')
  .description('下载文件')
  .argument('<torrent>', '种子文件路径')
  .argument('<output>', '输出文件路径')
  .option('-p, --peer-port <number>', 'P2P端口', '6883')
  .option('-d, --dht-port <number>', 'DHT端口', '6882')
  .action(async (torrentPath, outputPath, options) => {
    const peerPort = parseInt(options.peerPort);
    const dhtPort = parseInt(options.dhtPort);

    const client = new P2PClient(peerPort, dhtPort);
    await client.start();

    console.log(chalk.blue('开始下载...'));

    const progressBar = new cliProgress.SingleBar({
      format: '进度 |' + chalk.cyan('{bar}') + '| {percentage}% | {downloaded}/{total} | {speed} | 节点: {peers}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    let started = false;
    let totalSize = 0;

    const onProgress = (stats: TransferStats) => {
      if (!started && stats.totalChunks > 0) {
        totalSize = stats.totalChunks * 1024 * 1024;
        progressBar.start(stats.totalChunks, 0, {
          speed: '0 B/s',
          peers: 0,
          downloaded: '0 B',
          total: formatBytes(totalSize)
        });
        started = true;
      }

      if (started) {
        progressBar.update(stats.downloadedChunks, {
          speed: formatSpeed(stats.averageSpeed),
          peers: stats.connectedPeers,
          downloaded: formatBytes(stats.bytesDownloaded),
          total: formatBytes(totalSize)
        });
      }
    };

    const success = await client.downloadTorrent(torrentPath, outputPath, onProgress);

    if (started) {
      progressBar.stop();
    }

    if (success) {
      console.log(chalk.green('\n下载完成！'));
      console.log(chalk.gray(`文件已保存到: ${outputPath}`));
    } else {
      console.log(chalk.red('\n下载失败'));
    }

    await client.stop();
    process.exit(0);
  });

program
  .command('share')
  .description('快速分享文件（一站式命令）')
  .argument('<file>', '要分享的文件路径')
  .option('-p, --port <number>', 'Tracker端口', '8080')
  .option('--no-encrypt', '禁用传输加密')
  .action(async (file, options) => {
    const port = parseInt(options.port);
    const encrypt = options.encrypt !== false;
    
    console.log(chalk.blue('正在启动Tracker服务器...'));
    const tracker = new TrackerServer(port);
    await tracker.start();

    const peerPort = port + 1;
    const dhtPort = port + 2;
    const trackerUrl = `http://localhost:${port}`;

    const client = new P2PClient(peerPort, dhtPort);
    await client.start();

    console.log(chalk.blue('正在创建种子文件...'));
    if (encrypt) {
      console.log(chalk.blue('使用AES-256-GCM加密传输'));
    }
    const torrent = await client.createTorrent(file, [trackerUrl], encrypt);
    
    console.log(chalk.green('\n===== 分享信息 ====='));
    console.log(chalk.white(`Tracker: ${trackerUrl}`));
    console.log(chalk.white(`Info Hash: ${torrent.infoHash}`));
    console.log(chalk.white(`文件名: ${torrent.metadata.fileName}`));
    console.log(chalk.white(`文件大小: ${formatBytes(torrent.metadata.fileSize)}`));
    console.log(chalk.white(`加密: ${torrent.encryptedAESKey ? '启用 (AES-256-GCM)' : '禁用'}`));
    console.log(chalk.white(`种子文件: ${file}.torrent`));
    console.log(chalk.green('==================\n'));
    console.log(chalk.yellow('下载命令:'));
    console.log(chalk.cyan(`  p2pfd download "${file}.torrent" "${torrent.metadata.fileName}"`));
    console.log(chalk.green('\n开始做种中... 按 Ctrl+C 停止'));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('错误:'), err.message);
  process.exit(1);
});
