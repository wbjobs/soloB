import VirtualProbe from '../src/virtualProbe';
import { SensorData } from '../src/types';

function testVirtualProbe() {
  console.log('=== 虚拟探针功能测试 ===\n');

  const probe = new VirtualProbe(60, 100);

  const lastKnownData: SensorData = {
    deviceId: 'device-001',
    timestamp: Date.now() - 3600000,
    temperature: -20,
    humidity: 60
  };

  const recoveryData: SensorData = {
    deviceId: 'device-001',
    timestamp: Date.now(),
    temperature: -5,
    humidity: 70
  };

  console.log('1. 生成离线期间虚拟数据:');
  console.log(`   离线前温度: ${lastKnownData.temperature}°C`);
  console.log(`   恢复时温度: ${recoveryData.temperature}°C`);
  console.log(`   离线时长: ${(recoveryData.timestamp - lastKnownData.timestamp) / 60000} 分钟\n`);

  const virtualData = probe.generateVirtualData(
    lastKnownData.deviceId,
    lastKnownData,
    recoveryData,
    true
  );

  console.log(`   生成虚拟数据点数量: ${virtualData.length}`);
  console.log('   虚拟数据预览:');
  virtualData.forEach((d, i) => {
    const timeStr = new Date(d.timestamp).toLocaleTimeString();
    console.log(`     [${i}] ${timeStr} - ${d.temperature.toFixed(2)}°C`);
  });
  console.log('');

  console.log('2. 检测离线期间温度超标:');
  const threshold = -18;
  const anomalyPoint = probe.detectOfflineAnomalyPoint(lastKnownData, recoveryData, threshold);
  if (anomalyPoint) {
    console.log(`   检测到温度超标, 阈值: ${threshold}°C`);
    console.log(`   预估超标时间: ${new Date(anomalyPoint.timestamp).toLocaleString()}`);
    console.log(`   超标时温度: ${anomalyPoint.temperature}°C`);
  } else {
    console.log('   未检测到温度超标');
  }
  console.log('');

  console.log('3. 估计任意时间点温度:');
  const targetTimestamp = lastKnownData.timestamp + (recoveryData.timestamp - lastKnownData.timestamp) / 2;
  const estimatedTemp = probe.estimateTemperatureAt(lastKnownData, recoveryData, targetTimestamp, true);
  console.log(`   目标时间: ${new Date(targetTimestamp).toLocaleString()}`);
  console.log(`   估计温度: ${estimatedTemp.toFixed(2)}°C`);
  console.log('');

  console.log('=== 测试完成 ===');
}

testVirtualProbe();
