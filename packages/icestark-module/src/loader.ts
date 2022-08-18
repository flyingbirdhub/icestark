import Sandbox from '@ice/sandbox';
import { getGlobalProp, noteGlobalProps } from './global';
import { StarkModule } from './modules';

export interface ImportTask {
  [name: string]: Promise<string[]>;
}

export type PromiseModule = Promise<Response>;

export interface Fetch {
  (input: RequestInfo, init?: RequestInit): Promise<Response>;
}

export default class ModuleLoader {
  private importTask: ImportTask = {};

  load(starkModule: StarkModule, fetch: Fetch = window.fetch): Promise<string[]> {
    const { url, name } = starkModule;
    // 对同一个名称的会进行缓存直接返回缓存结果
    // 返回的是一个promise数组对象通过await可以直接获取到值，为一个字符串
    if (this.importTask[name]) {
      // return promise if current module is pending or resolved
      return this.importTask[name];
    }
    const urls = Array.isArray(url) ? url : [url];

    const task = Promise.all(
      urls.map(
        (scriptUrl) => fetch(scriptUrl)
          .then((res) => res.text())
          .then((res) => `${res} \n //# sourceURL=${scriptUrl}`),
      ),
    );
    this.importTask[name] = task;
    return task;
  }

  removeTask(name: string) {
    delete this.importTask[name];
  }

  clearTask() {
    this.importTask = {};
  }

  execModule(starkModule: StarkModule, sandbox?: Sandbox, deps?: object) {
    // sources是返回的脚本字符串数组
    return this.load(starkModule).then((sources) => {
      let globalWindow = null;
      // 其实这里应该是判断sandbox是否是Sandbox的实例，感觉写的并不是很清晰
      if (sandbox?.getSandbox) {
        // 根据deps创建一个proxy
        sandbox.createProxySandbox(deps);
        // globalWindow其实就是创建的proxy对象
        globalWindow = sandbox.getSandbox();
      } else {
        // 不开启sandbox时，就是window本身
        globalWindow = window;
      }
      const { name } = starkModule;
      let libraryExport = '';
      // excute script in order
      try {
        sources.forEach((source, index) => {
          // 最后一个脚本
          const lastScript = index === sources.length - 1;
          if (lastScript) {
            // 遍历一遍未运行source前的globalWindow上的属性
            noteGlobalProps(globalWindow);
          }
          // check sandbox
          if (sandbox?.execScriptInSandbox) {
            // 在沙箱中运行JS脚本
            sandbox.execScriptInSandbox(source);
          } else {
            // https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/eval
            // eslint-disable-next-line no-eval
            (0, eval)(source);
          }
          if (lastScript) {
            libraryExport = getGlobalProp(globalWindow);
          }
        });
      } catch (err) {
        console.error(err);
      }
      const moduleInfo = libraryExport ? (globalWindow as any)[libraryExport] : ((globalWindow as any)[name] || {});
      // remove moduleInfo from globalWindow in case of excute multi module in globalWindow
      if ((globalWindow as any)[libraryExport]) {
        delete globalWindow[libraryExport];
      }
      return moduleInfo;
    });
  }
}
