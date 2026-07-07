/**
 * 《操作系统原理》课程聚合索引 —— 30 讲一讲一个知识点。
 * 课程蓝本:南京大学 jyy《操作系统原理》2026 春(https://jyywiki.cn/OS/2026/),
 * 每个知识点的备课包 references 挂对应讲次的 jyywiki 讲义与 B 站视频回看。
 * 集成约定:本文件是唯一接线点 —— data/index.ts / demoScript.ts / selfTest.ts /
 * scripts/simulate.ts 均从这里取数,作者代理只改各自的知识点文件,不碰本文件。
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';
import { osOverviewTopic, osOverviewDemo, osOverviewSelfTest } from './overview';
import { osAppViewTopic, osAppViewDemo, osAppViewSelfTest } from './appView';
import { osHwViewTopic, osHwViewDemo, osHwViewSelfTest } from './hwView';
import { osScalingLawAsideTopic, osScalingLawAsideDemo, osScalingLawAsideSelfTest } from './scalingLawAside';
import { osProcessTopic, osProcessDemo, osProcessSelfTest } from './process';
import { osAddressSpaceTopic, osAddressSpaceDemo, osAddressSpaceSelfTest } from './addressSpace';
import { osObjectsTopic, osObjectsDemo, osObjectsSelfTest } from './osObjects';
import { osShellTopic, osShellDemo, osShellSelfTest } from './shell';
import { osLibcTopic, osLibcDemo, osLibcSelfTest } from './libc';
import { osLibcDebugTopic, osLibcDebugDemo, osLibcDebugSelfTest } from './libcDebug';
import { osLinkingTopic, osLinkingDemo, osLinkingSelfTest } from './linking';
import { osAppWorldTopic, osAppWorldDemo, osAppWorldSelfTest } from './appWorld';
import { osMultiprocessorTopic, osMultiprocessorDemo, osMultiprocessorSelfTest } from './multiprocessor';
import { osMutexTopic, osMutexDemo, osMutexSelfTest } from './mutex';
import { osCondvarTopic, osCondvarDemo, osCondvarSelfTest } from './condvar';
import { osSemaphoreTopic, osSemaphoreDemo, osSemaphoreSelfTest } from './semaphore';
import { osConcurrencyBugsTopic, osConcurrencyBugsDemo, osConcurrencyBugsSelfTest } from './concurrencyBugs';
import { osParallelTopic, osParallelDemo, osParallelSelfTest } from './parallel';
import { osAsyncTopic, osAsyncDemo, osAsyncSelfTest } from './async';
import { osGpuTopic, osGpuDemo, osGpuSelfTest } from './gpu';
import { osTokenJourneyTopic, osTokenJourneyDemo, osTokenJourneySelfTest } from './tokenJourney';
import { osIoDevicesTopic, osIoDevicesDemo, osIoDevicesSelfTest } from './ioDevices';
import { osStorageTopic, osStorageDemo, osStorageSelfTest } from './storage';
import { osFsApi1Topic, osFsApi1Demo, osFsApi1SelfTest } from './fsApi1';
import { osFsApi2Topic, osFsApi2Demo, osFsApi2SelfTest } from './fsApi2';
import { osFsImplTopic, osFsImplDemo, osFsImplSelfTest } from './fsImpl';
import { osDatabaseTopic, osDatabaseDemo, osDatabaseSelfTest } from './database';
import { osSecurityTopic, osSecurityDemo, osSecuritySelfTest } from './security';
import { osVirtualizationTopic, osVirtualizationDemo, osVirtualizationSelfTest } from './virtualization';
import { osSummaryTopic, osSummaryDemo, osSummarySelfTest } from './summary';

/** 陈列顺序 = 讲次顺序 */
export const OS_TOPICS: Topic[] = [
  osOverviewTopic,
  osAppViewTopic,
  osHwViewTopic,
  osScalingLawAsideTopic,
  osProcessTopic,
  osAddressSpaceTopic,
  osObjectsTopic,
  osShellTopic,
  osLibcTopic,
  osLibcDebugTopic,
  osLinkingTopic,
  osAppWorldTopic,
  osMultiprocessorTopic,
  osMutexTopic,
  osCondvarTopic,
  osSemaphoreTopic,
  osConcurrencyBugsTopic,
  osParallelTopic,
  osAsyncTopic,
  osGpuTopic,
  osTokenJourneyTopic,
  osIoDevicesTopic,
  osStorageTopic,
  osFsApi1Topic,
  osFsApi2Topic,
  osFsImplTopic,
  osDatabaseTopic,
  osSecurityTopic,
  osVirtualizationTopic,
  osSummaryTopic,
];

export const OS_DEMOS: Record<string, DemoLine[]> = {
  'os-overview': osOverviewDemo,
  'os-app-view': osAppViewDemo,
  'os-hw-view': osHwViewDemo,
  'os-scaling-law': osScalingLawAsideDemo,
  'os-process': osProcessDemo,
  'os-address-space': osAddressSpaceDemo,
  'os-objects': osObjectsDemo,
  'os-shell': osShellDemo,
  'os-libc': osLibcDemo,
  'os-libc-debug': osLibcDebugDemo,
  'os-linking': osLinkingDemo,
  'os-app-world': osAppWorldDemo,
  'os-multiprocessor': osMultiprocessorDemo,
  'os-mutex': osMutexDemo,
  'os-condvar': osCondvarDemo,
  'os-semaphore': osSemaphoreDemo,
  'os-concurrency-bugs': osConcurrencyBugsDemo,
  'os-parallel': osParallelDemo,
  'os-async': osAsyncDemo,
  'os-gpu': osGpuDemo,
  'os-token-journey': osTokenJourneyDemo,
  'os-io-devices': osIoDevicesDemo,
  'os-storage': osStorageDemo,
  'os-fs-api-1': osFsApi1Demo,
  'os-fs-api-2': osFsApi2Demo,
  'os-fs-impl': osFsImplDemo,
  'os-database': osDatabaseDemo,
  'os-security': osSecurityDemo,
  'os-virtualization': osVirtualizationDemo,
  'os-summary': osSummaryDemo,
};

export const OS_SELF_TESTS: Record<string, SelfTestItem[]> = {
  'os-overview': osOverviewSelfTest,
  'os-app-view': osAppViewSelfTest,
  'os-hw-view': osHwViewSelfTest,
  'os-scaling-law': osScalingLawAsideSelfTest,
  'os-process': osProcessSelfTest,
  'os-address-space': osAddressSpaceSelfTest,
  'os-objects': osObjectsSelfTest,
  'os-shell': osShellSelfTest,
  'os-libc': osLibcSelfTest,
  'os-libc-debug': osLibcDebugSelfTest,
  'os-linking': osLinkingSelfTest,
  'os-app-world': osAppWorldSelfTest,
  'os-multiprocessor': osMultiprocessorSelfTest,
  'os-mutex': osMutexSelfTest,
  'os-condvar': osCondvarSelfTest,
  'os-semaphore': osSemaphoreSelfTest,
  'os-concurrency-bugs': osConcurrencyBugsSelfTest,
  'os-parallel': osParallelSelfTest,
  'os-async': osAsyncSelfTest,
  'os-gpu': osGpuSelfTest,
  'os-token-journey': osTokenJourneySelfTest,
  'os-io-devices': osIoDevicesSelfTest,
  'os-storage': osStorageSelfTest,
  'os-fs-api-1': osFsApi1SelfTest,
  'os-fs-api-2': osFsApi2SelfTest,
  'os-fs-impl': osFsImplSelfTest,
  'os-database': osDatabaseSelfTest,
  'os-security': osSecuritySelfTest,
  'os-virtualization': osVirtualizationSelfTest,
  'os-summary': osSummarySelfTest,
};

export const OS_TOPIC_IDS: string[] = OS_TOPICS.map((t) => t.topicId);
