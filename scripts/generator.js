// scripts/generator.js
import fs from 'fs';
import path from 'path';


const SEARCH_QUERIES = [
  'vless free filename:txt',
  'vmess free filename:yaml',
  'trojan free subscription',
  'singbox free filename:json',
  'clash node yaml'
];


async function searchGitHubNodes() {
  let allNodeLinks = [];
  
  for (const query of SEARCH_QUERIES) {
    try {
      console.log(`正在搜索: ${query}`);
     
      const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}+sort:updated-desc`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Node-Fetcher-Bot',
         
          ...(process.env.GH_TOKEN && { 'Authorization': `Bearer ${process.env.GH_TOKEN}` })
        }
      });

      if (!response.ok) {
        console.warn(`搜索失败 (${response.status}): ${query}`);
        continue;
      }

      const data = await response.json();
      if (!data.items) continue;

     
      for (const item of data.items) {
       
        const rawUrl = item.html_url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
        
        console.log(`抓取目标: ${rawUrl}`);
        const contentRes = await fetch(rawUrl);
        if (contentRes.ok) {
          const text = await contentRes.text();
          allNodeLinks.push(text);
        }
      }
      
  
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.error(`抓取异常: ${e.message}`);
    }
  }

  return allNodeLinks.join('\n');
}


function parseAndCleanNodes(rawText) {

  const regex = /((vless|vmess|trojan|ss|ssr|hysteria|tuic):\/\/[^\s"'<>]+)/g;
  const matches = rawText.match(regex) || [];
  

  const uniqueNodes = [...new Set(matches)];
  console.log(`成功提取到有效节点数量: ${uniqueNodes.length}`);
  return uniqueNodes;
}


async function main() {
  console.log('...');
  const rawData = await searchGitHubNodes();
  const nodes = parseAndCleanNodes(rawData);

  if (nodes.length === 0) {
    console.log('?');
    return;
  }

 
  const outputDir = path.resolve('output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }


  const uriListContent = nodes.join('\n');
  fs.writeFileSync(path.join(outputDir, 'nodes.txt'), uriListContent);
  

  const base64Content = Buffer.from(uriListContent).toString('base64');
  fs.writeFileSync(path.join(outputDir, 'v2ray-base64.txt'), base64Content);

  console.log('！');
}

main();
