const coap = require('coap');
const mdns = require('multicast-dns');
const KnowledgeBase = require('./knowledge-base');

class OCFService {
  constructor() {
    this.devices = new Map();
    this.knowledgeBase = new KnowledgeBase();
  }

  async discoverDevices() {
    return new Promise((resolve) => {
      const devices = [];
      const mdnsClient = mdns();

      mdnsClient.on('response', (response) => {
        const ocfService = response.answers.find(
          a => a.type === 'PTR' && a.name === '_ocf._udp.local'
        );

        if (ocfService) {
          const srvRecord = response.answers.find(
            a => a.type === 'SRV' && a.name === ocfService.data
          );

          const aRecord = response.additionals.find(
            a => a.type === 'A' && (srvRecord ? a.name === srvRecord.data.target : false)
          );

          if (srvRecord && aRecord) {
            const device = {
              id: ocfService.data,
              name: ocfService.data.replace('._ocf._udp.local', ''),
              ip: aRecord.data,
              port: srvRecord.data.port
            };

            if (!this.devices.has(device.id)) {
              this.devices.set(device.id, device);
              devices.push(device);
            }
          }
        }
      });

      mdnsClient.query('_ocf._udp.local', 'PTR');
      
      setTimeout(() => {
        mdnsClient.query('_ocf._udp.local', 'PTR');
      }, 3000);

      setTimeout(() => {
        mdnsClient.query('_ocf._udp.local', 'PTR');
      }, 6000);

      setTimeout(() => {
        mdnsClient.destroy();
        
        const finalDevices = Array.from(this.devices.values());
        
        if (finalDevices.length === 0) {
          finalDevices.push({
            id: 'demo-device-001',
            name: 'OCF演示设备',
            ip: '127.0.0.1',
            port: 5683
          });
        }
        
        resolve(finalDevices);
      }, 10000);
    });
  }

  async runTestCase(device, testCase) {
    const startTime = Date.now();
    const result = {
      resourcePath: testCase.name,
      description: testCase.description,
      status: 'fail',
      httpCode: null,
      responseBody: null,
      errorMessage: null,
      duration: 0,
      deviceInfo: `${device.ip}:${device.port}`
    };

    try {
      const response = await this.coapRequest(device.ip, device.port, testCase.name);
      
      result.duration = Date.now() - startTime;
      result.httpCode = response.code;
      result.responseBody = response.payload;

      if (response.code.startsWith('2.')) {
        result.status = 'pass';
      } else {
        result.errorMessage = `HTTP ${response.code}`;
      }
    } catch (error) {
      result.duration = Date.now() - startTime;
      
      if (error.message === '请求超时') {
        result.errorMessage = `请求超时 (${result.duration}ms) - 设备 ${device.ip}:${device.port} 无响应`;
        result.responseBody = { 
          error: 'timeout',
          timeout: true,
          duration: result.duration,
          device: `${device.ip}:${device.port}`,
          resource: testCase.name
        };
      } else if (error.code === 'ECONNREFUSED') {
        result.errorMessage = `连接被拒绝 - 设备 ${device.ip}:${device.port} 端口 ${device.port} 不可达`;
        result.responseBody = {
          error: 'connection_refused',
          device: `${device.ip}:${device.port}`
        };
      } else if (error.code === 'ENETUNREACH') {
        result.errorMessage = `网络不可达 - 设备 ${device.ip} 无法访问`;
        result.responseBody = {
          error: 'network_unreachable',
          device: device.ip
        };
      } else {
        result.errorMessage = error.message;
        result.responseBody = { 
          error: error.message,
          code: error.code || 'unknown'
        };
      }
    }

    return result;
  }

  coapRequest(host, port, path) {
    return new Promise((resolve, reject) => {
      const req = coap.request({
        host: host,
        port: port,
        pathname: path,
        method: 'GET',
        options: {
          'Content-Format': 'application/json'
        },
        retrySend: 2
      });

      const timeout = setTimeout(() => {
        req.abort();
        const error = new Error('请求超时');
        error.code = 'ETIMEDOUT';
        reject(error);
      }, 10000);

      req.on('response', (res) => {
        clearTimeout(timeout);
        
        let payload = '';
        res.on('data', (chunk) => {
          payload += chunk.toString();
        });

        res.on('end', () => {
          try {
            const parsed = payload ? JSON.parse(payload) : {};
            resolve({
              code: res.code,
              payload: parsed
            });
          } catch (e) {
            resolve({
              code: res.code,
              payload: { raw: payload }
            });
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.end();
    };
  }

  getRepairSuggestions(results) {
    return this.knowledgeBase.analyzeTestResults(results);
  }

  getSolutionById(id) {
    return this.knowledgeBase.getSolutionById(id);
  }

  getAllKnowledgeBase() {
    return this.knowledgeBase.getAllSolutions();
  }
}

module.exports = OCFService;