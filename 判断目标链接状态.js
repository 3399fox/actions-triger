export default {
  async scheduled(event, env, ctx) {
    // 1. 配置任务列表：每个目标链接对应一个工作流
    const tasks = [
      {
        target_url: "https://funmitglx.g1-eu-west.galaxycloud.app", // 监控的目标链接
        owner: "jacobax",
        repo: "galaxy",
        workflow_id: "main.yml",
        ref: "main"
      },
      {
        target_url: "https://pa738282--xdemo-web-server.modal.run",
        owner: "jacobax",
        repo: "python-argo-modal",
        workflow_id: "modal_deploy.yml",
        ref: "main"
      }
//      {
//        target_url: "https://pa738282--xdemo-web-server.modal.run",
//        owner: "jacobax",
//        repo: "python-argo-modal",
//        workflow_id: "modal_deploy.yml",
//        ref: "main"
//      }
    ];

    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    const WAIT_TIME = 60 * 60 * 1000; // 60分钟的毫秒数

    // 2. 并行处理所有监控任务
    const results = await Promise.allSettled(
      tasks.map(task => processTask(task, GITHUB_TOKEN, env.TRIGGER_KV, WAIT_TIME))
    );

    console.log("所有任务检查完毕");
  },

  // 手动触发测试接口
  async fetch(request, env, ctx) {
    await this.scheduled(null, env, ctx);
    return new Response("Check completed. See logs for details.");
  }
};

/**
 * 处理单个任务的逻辑
 */
async function processTask(task, token, kv, waitTime) {
  const { target_url, owner, repo, workflow_id, ref } = task;
  const kvKey = `last_trigger:${owner}:${repo}:${workflow_id}`;

  try {
    // 步骤 A: 检查目标链接状态码
    const response = await fetch(target_url, { 
      method: 'GET',
      headers: { 'User-Agent': 'CF-Worker-Monitor' } 
    });

    if (response.status !== 404) {
      console.log(`[跳过] ${target_url} 状态码为 ${response.status}，非 404`);
      return;
    }

    // 步骤 B: 检查冷却时间
    const lastTriggered = await kv.get(kvKey);
    const now = Date.now();

    if (lastTriggered && (now - parseInt(lastTriggered) < waitTime)) {
      const remaining = Math.round((waitTime - (now - parseInt(lastTriggered))) / 60000);
      console.log(`[冷却中] ${owner}/${repo} 最近触发过，还需等待 ${remaining} 分钟`);
      return;
    }

    // 步骤 C: 触发 GitHub Action
    console.log(`[执行] 检测到 404，正在触发工作流: ${owner}/${repo}`);
    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`;
    
    const ghRes = await fetch(ghUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "CF-Worker-Trigger",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs: {} }),
    });

    if (ghRes.ok) {
      // 步骤 D: 更新 KV 记录时间
      await kv.put(kvKey, now.toString());
      console.log(`[成功] ${owner}/${repo} 工作流已启动`);
    } else {
      const err = await ghRes.text();
      console.error(`[GitHub API 错误] ${ghRes.status}: ${err}`);
    }

  } catch (error) {
    console.error(`[运行时异常] 处理 ${target_url} 时出错: ${error.message}`);
  }
}
