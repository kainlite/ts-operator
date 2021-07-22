An Example Operator written in TypeScript based in [This example from OpenShift](https://github.com/nodeshift-blog-examples/operator-in-JavaScript).

## Getting Started

Launch a kind cluster or have a kubeconfig ready for another cluster:

```bash
kind create cluster
```

Start by creating all the resources:

```bash
kustomize build resources | kubectl apply -f -
```

This will create the `ts-operator` namespace and populate it with ImageStreams, a BuildConfig and a Deployment running the operator.

It will also create `MyCustomResource` Custom Resource Definition and the `mycustomresource-editor` Role.

Tail the logs of the operator by running:

```bash
kubectl -n ts-operator logs -f deployment/ts-operator
```

In a different terminal, create an instance of the CRD by running:

```bash
kubectl create -f resources/memcached-sample.yaml
```

You will see a new Deployment called `mycustomresource-sample` with pods starting.

Now modify the size property in your Custom Resource:

```bash
kubectl edit mycustomresource mycustomresource-sample
```

Replace the size value from 1 to 2, then save. You will see the size of your deployment go from 1 to 2 and new pods starting.

# Cleaning up

You can delete all the resources created earlier by running:

```bash
kustomize build resources | kubectl delete -f -
```
