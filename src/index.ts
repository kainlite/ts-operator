/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as k8s from "@kubernetes/client-node";
import * as fs from "fs";

//process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
const MYCUSTOMRESOURCE_GROUP = "custom.example.com";
const MYCUSTOMRESOURCE_VERSION = "v1";
const MYCUSTOMRESOURCE_PLURAL = "mycustomresources";
const NAMESPACE = "ts-operator";

interface MyCustomResourceSpec {
  size: number;
}
interface MyCustomResourceStatus {
  pods: string[];
}
interface MyCustomResource {
  apiVersion: string;
  kind: string;
  metadata: k8s.V1ObjectMeta;
  spec?: MyCustomResourceSpec;
  status?: MyCustomResourceStatus;
}

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
const k8sApiMC = kc.makeApiClient(k8s.CustomObjectsApi);
const k8sApiPods = kc.makeApiClient(k8s.CoreV1Api);

const deploymentTemplate = fs.readFileSync("deployment.json", "utf-8");
const watch = new k8s.Watch(kc);

async function onEvent(phase: string, apiObj: any) {
  log(`Received event in phase ${phase}.`);
  if (phase == "ADDED") {
    scheduleReconcile(apiObj);
  } else if (phase == "MODIFIED") {
    scheduleReconcile(apiObj);
  } else if (phase == "DELETED") {
    await deleteResource(apiObj);
  } else {
    log(`Unknown event type: ${phase}`);
  }
}

async function deleteResource(obj: MyCustomResource) {
  log(`Deleted ${obj.metadata.name}`);
  return k8sApi.deleteNamespacedDeployment(obj.metadata.name!, NAMESPACE);
}

function onDone(err: any) {
  log(`Connection closed. ${err}`);
  watchResource();
}

async function watchResource(): Promise<any> {
  log("Watching API");
  return watch.watch(
    `/apis/${MYCUSTOMRESOURCE_GROUP}/${MYCUSTOMRESOURCE_VERSION}/namespaces/${NAMESPACE}/${MYCUSTOMRESOURCE_PLURAL}`,
    {},
    onEvent,
    onDone,
  );
}

let reconcileScheduled = false;

function scheduleReconcile(obj: MyCustomResource) {
  if (!reconcileScheduled) {
    setTimeout(reconcileNow, 1000, obj);
    reconcileScheduled = true;
  }
}

async function reconcileNow(obj: MyCustomResource) {
  reconcileScheduled = false;
  const deploymentName: string = obj.metadata.name!;
  //check if deployment exists. Create it if it doesn't.
  try {
    const response = await k8sApi.readNamespacedDeployment(deploymentName, NAMESPACE);
    //patch the deployment
    const deployment: k8s.V1Deployment = response.body;
    deployment.spec!.replicas = obj.spec!.size;
    k8sApi.replaceNamespacedDeployment(deploymentName, NAMESPACE, deployment);
  } catch (err) {
    //Create the deployment
    const newDeployment: k8s.V1Deployment = JSON.parse(deploymentTemplate);
    newDeployment.metadata!.name = deploymentName;
    newDeployment.spec!.replicas = obj.spec!.size;
    newDeployment.spec!.selector!.matchLabels!["deployment"] = deploymentName;
    newDeployment.spec!.template!.metadata!.labels!["deployment"] = deploymentName;
    k8sApi.createNamespacedDeployment(NAMESPACE, newDeployment);
  }
  //set the status of our resource to the list of pod names.
  const status: MyCustomResource = {
    apiVersion: obj.apiVersion,
    kind: obj.kind,
    metadata: {
      name: obj.metadata.name!,
      resourceVersion: obj.metadata.resourceVersion,
    },
    status: {
      pods: await getPodList(`deployment=${obj.metadata.name}`),
    },
  };

  k8sApiMC.replaceNamespacedCustomObjectStatus(
    MYCUSTOMRESOURCE_GROUP,
    MYCUSTOMRESOURCE_VERSION,
    NAMESPACE,
    MYCUSTOMRESOURCE_PLURAL,
    obj.metadata.name!,
    status,
  );
}
async function getPodList(podSelector: string): Promise<string[]> {
  try {
    const podList = await k8sApiPods.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      podSelector,
    );
    return podList.body.items.map((pod) => pod.metadata!.name!);
  } catch (err) {
    log(err);
  }
  return [];
}

async function main() {
  await watchResource();
}

function log(message: string) {
  console.log(`${new Date().toLocaleString()}: ${message}`);
}

main();
