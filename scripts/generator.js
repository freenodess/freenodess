import fs from 'fs';
import path from 'path';
import net from 'net';
import { URL } from 'url';
import YAML from 'yaml';


const SEARCH_QUERIES = [
  'vless free filename:txt',
  'vmess free filename:yaml',
  'trojan free subscription',
  'clash node yaml'
];


async function searchGitHubNodes() {
  let allNodeLinks = [];
  
  for (const query of SEARCH_QUERIES) {
    try {
      console.log(`正在: ${query}`);
      const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}+sort:updated-desc`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Node-Fetcher-Bot',
          ...(process.env.GH_TOKEN && { 'Authorization': `Bearer ${process.env.GH_TOKEN}` })
        }
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (!data.items) continue;

      for (const item of data.items.slice(0, 5)) {
        const rawUrl = item.html_url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
        
        const contentRes = await fetch(rawUrl);
        if (contentRes.ok) {
          const text = await contentRes.text();
          allNodeLinks.push(text);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (e) {
      console.error(`抓取异常: ${e.message}`);
    }
  }

  return allNodeLinks.join('\n');
}


function parseAndCleanNodes(rawText) {
  const regex = /((vless|vmess|trojan|ss|ssr|anytls|hysteria|hysteria2):\/\/[^\s"'<>]+)/g;
  const matches = rawText.match(regex) || [];
  return [...new Set(matches)];
}


// 3. 优化后的 TCP 测速（更严格、更快速）
function testNodeSpeed(nodeUri, timeout = 500) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(nodeUri);
      const host = parsed.hostname;
      const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
      
      if (!host || !port) return resolve(null);

      const startTime = Date.now();
      const socket = new net.Socket();

      let settled = false;
      const done = (latency) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        // 过滤掉超过 1000ms 的慢节点
        if (latency !== null && latency > 1000) {
          resolve(null);
        } else {
          resolve(latency);
        }
      };

      socket.setTimeout(timeout);
      socket.on('connect', () => done(Date.now() - startTime));
      socket.on('timeout', () => done(null));
      socket.on('error', () => done(null));

      socket.connect(port, host);
    } catch {
      resolve(null);
    }
  });
}

// 4. 并发测速并严格筛选
async function filterAndSelectTopNodes(nodeUris, limit = 50) {
  console.log(`开始对抓取到的 ${nodeUris.length} 个节点进行严格 TCP 连通性测试...`);
  
  let aliveNodes = [];
  const batchSize = 30; // 增大并发提高速度
  
  for (let i = 0; i < nodeUris.length; i += batchSize) {
    const batch = nodeUris.slice(i, i + batchSize);
    const promises = batch.map(async (uri) => {
      const latency = await testNodeSpeed(uri);
      return latency !== null ? { uri, latency } : null;
    });

    const results = await Promise.all(promises);
    for (const res of results) {
      if (res) aliveNodes.push(res);
    }
  }

  // 按照延迟升序排序
  aliveNodes.sort((a, b) => a.latency - b.latency);
  console.log(`测速完成！通过初步筛选的存活节点数: ${aliveNodes.length}`);

  // 默认输出质量最高的前 50 个（宁缺毋滥，减少死节点）
  const selected = aliveNodes.slice(0, limit).map(item => item.uri);
  console.log(`已成功挑选出延迟最优的前 ${selected.length} 个节点。`);
  return selected;
}


function convertUriToClashProxy(uri, index) {
  try {
    const parsed = new URL(uri);
    const protocol = parsed.protocol.replace(':', '');
    const name = `Node_${index + 1}_${parsed.hostname.slice(0, 6)}_${parsed.port || '443'}`;

    let proxy = {
      name: name,
      server: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 443,
      type: protocol
    };

    if (protocol === 'vless') {
      proxy.uuid = parsed.username;
      proxy.tls = parsed.searchParams.get('security') === 'tls';
      proxy.network = parsed.searchParams.get('type') || 'tcp';
      if (proxy.network === 'ws') {
        proxy['ws-opts'] = { path: parsed.searchParams.get('path') || '/' };
      }
    } else if (protocol === 'vmess') {

      proxy.type = 'vmess';
      proxy.uuid = parsed.username;
      proxy.alterId = parseInt(parsed.searchParams.get('aid') || '0', 10);
      proxy.cipher = 'auto';
      proxy.tls = parsed.searchParams.get('security') === 'tls';
    } else if (protocol === 'trojan') {
      proxy.password = parsed.username;
      proxy.tls = true;
    } else if (protocol === 'ss') {
      // Shadowsocks 协议 (aes-256-gcm:password@server:port)
      proxy.type = 'ss';
      if (parsed.username && parsed.password) {
        proxy.cipher = parsed.username;
        proxy.password = parsed.password;
      } else if (parsed.username) {
       
        proxy.cipher = 'aes-256-gcm';
        proxy.password = parsed.username;
      }
    } else if (protocol === 'hysteria2' || protocol === 'hysteria') {
      proxy.type = 'hysteria2';
      proxy.up = '100 Mbps';
      proxy.down = '100 Mbps';
      proxy.password = parsed.username || parsed.password;
      proxy['skip-cert-verify'] = true;
    } else if (protocol === 'anytls') {
      
      proxy.type = 'anytls';
      proxy.uuid = parsed.username;
      proxy.tls = true;
      proxy['skip-cert-verify'] = true;
    } else {
      
      return null;
    }

    return proxy;
  } catch (e) {
    return null;
  }
}

function generateClashYaml(nodes) {
  const proxies = [];
  const proxyNames = [];

  nodes.forEach((uri, index) => {
    const proxyObj = convertUriToClashProxy(uri, index);
    if (proxyObj) {
      proxies.push(proxyObj);
      proxyNames.push(proxyObj.name);
    }
  });

  const clashConfig = {
    port: 7890,
    'socks-port': 7891,
    'allow-lan': true,
    mode: 'rule',
    'log-level': 'info',
    proxies: proxies,
    'proxy-groups': [
      {
        name: '🚀 节点选择',
        type: 'select',
        proxies: ['♻️ 自动选择', 'DIRECT', ...proxyNames]
      },
      {
        name: '♻️ 自动选择',
        type: 'url-test',
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
        tolerance: 50,
        proxies: proxyNames.length > 0 ? proxyNames : ['DIRECT']
      },
      {
        name: '🎯 全球直连',
        type: 'select',
        proxies: ['DIRECT', '🚀 节点选择']
      }
    ],
    rules: [
      'DOMAIN-SUFFIX,local,DIRECT',
      'GEOIP,private,DIRECT',
      'GEOIP,cn,🎯 全球直连',
      'MATCH,🚀 节点选择'
    ]
  };

  return YAML.stringify(clashConfig);
}

// 主流程
async function main() {
  console.log('...');
  const rawData = await searchGitHubNodes();
  const rawNodes = parseAndCleanNodes(rawData);

  if (rawNodes.length === 0) {
    console.log('终止更新。');
    return;
  }


  const topNodes = await filterAndSelectTopNodes(rawNodes, 100);
  if (topNodes.length === 0) {
    console.log('。');
    return;
  }

  const outputDir = path.resolve('output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }


  const uriListContent = topNodes.join('\n');
  fs.writeFileSync(path.join(outputDir, 'nodes.txt'), uriListContent);
  
 
  const base64Content = Buffer.from(uriListContent).toString('base64');
  fs.writeFileSync(path.join(outputDir, 'v2ray-base64.txt'), base64Content);


  const clashYamlContent = generateClashYaml(topNodes);
  fs.writeFileSync(path.join(outputDir, 'clash.yaml'), clashYamlContent);

  console.log(`成功！ ${topNodes.length} `);
}

main();
