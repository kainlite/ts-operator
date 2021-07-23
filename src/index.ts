/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as k8s from "@kubernetes/client-node";
import * as fs from "fs";

// Configure the operator to deploy your custom resources
// and the destination namespace for your pods
const MYCUSTOMRESOURCE_GROUP = "custom.example.com";
const MYCUSTOMRESOURCE_VERSION = "v1";
const MYCUSTOMRESOURCE_PLURAL = "mycustomresources";
const NAMESPACE = "workers";

// This value specifies the amount of pods that your deployment will have
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

// Generates a client from an existing kubeconfig whether in memory
// or from a file.
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

// Creates the different clients for the different parts of the API.
const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
const k8sApiMC = kc.makeApiClient(k8s.CustomObjectsApi);
const k8sApiPods = kc.makeApiClient(k8s.CoreV1Api);

// This is to listen for events or notifications and act accordingly
// after all it is the core part of a controller or operator to
// watch or observe, compare and reconcile
const watch = new k8s.Watch(kc);

// Then this function determines what flow needs to happen
// Create, Update or Destroy?
async function onEvent(phase: string, apiObj: any) {
  log(`Received event in phase ${phase}.`);
  if (phase == "ADDED") {
    scheduleReconcile(apiObj);
  } else if (phase == "MODIFIED") {
    try {
      scheduleReconcile(apiObj);
    } catch (err) {
      log(err);
    }
  } else if (phase == "DELETED") {
    await deleteResource(apiObj);
  } else {
    log(`Unknown event type: ${phase}`);
  }
}

// Call the API to destroy the resource, happens when the CRD instance is deleted.
async function deleteResource(obj: MyCustomResource) {
  log(`Deleted ${obj.metadata.name}`);
  return k8sApi.deleteNamespacedDeployment(obj.metadata.name!, NAMESPACE);
}

// Helpers to continue watching after an event
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

// Keep the controller checking every 1000 ms
// If after any condition the controller needs to be stopped
// it can be done by setting reconcileScheduled to true
function scheduleReconcile(obj: MyCustomResource) {
  if (!reconcileScheduled) {
    setTimeout(reconcileNow, 1000, obj);
    reconcileScheduled = true;
  }
}

// This is probably the most complex function since it first checks if the
// deployment already exists and if it doesn't it creates the resource.
// If it does exists updates the resources and leaves early.
async function reconcileNow(obj: MyCustomResource) {
  reconcileScheduled = false;
  const deploymentName: string = obj.metadata.name!;
  // Check if the deployment exists and patch it.
  try {
    const response = await k8sApi.readNamespacedDeployment(deploymentName, NAMESPACE);
    const deployment: k8s.V1Deployment = response.body;
    deployment.spec!.replicas = obj.spec!.size;
    k8sApi.replaceNamespacedDeployment(deploymentName, NAMESPACE, deployment);
    return;
  } catch (err) {
    log("An unexpected error occurred...");
    log(err);
  }

  // Create the deployment if it doesn't exists
  try {
    const deploymentTemplate = fs.readFileSync("deployment.json", "utf-8");
    const newDeployment: k8s.V1Deployment = JSON.parse(deploymentTemplate);

    newDeployment.metadata!.name = deploymentName;
    newDeployment.spec!.replicas = obj.spec!.size;
    newDeployment.spec!.selector!.matchLabels!["deployment"] = deploymentName;
    newDeployment.spec!.template!.metadata!.labels!["deployment"] = deploymentName;
    k8sApi.createNamespacedDeployment(NAMESPACE, newDeployment);
  } catch (err) {
    log("Failed to parse template: deployment.json");
    log(err);
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

  try {
    k8sApiMC.replaceNamespacedCustomObjectStatus(
      MYCUSTOMRESOURCE_GROUP,
      MYCUSTOMRESOURCE_VERSION,
      NAMESPACE,
      MYCUSTOMRESOURCE_PLURAL,
      obj.metadata.name!,
      status,
    );
  } catch (err) {
    log(err);
  }
}

// Helper to get the pod list for the given deployment.
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

// The watch has begun
async function main() {
  await watchResource();
}

// Helper to pretty print logs
function log(message: string) {
  console.log(`${new Date().toLocaleString()}: ${message}`);
}

// Helper to get better errors if we miss any promise rejection.
process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise", p, "reason:", reason);
});

// Run
main();
