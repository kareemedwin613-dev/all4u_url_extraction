import React, { useEffect, useState } from "react";
import { App as AntdApp, Button, Card, Empty, Select, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { cancelTailoringJob, listTailoringJobs, openTailoringResume } from "../../services/tailoring-job-service.js";
import { QueueCard } from "../components/QueueCard.jsx";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "PROCESSING", label: "Processing" },
  { value: "NEEDS_REVIEW", label: "Needs Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function QueueView({ client, backendBaseUrl, onError }) {
  const { modal } = AntdApp.useApp();
  const [status, setStatus] = useState("ALL");
  const [items, setItems] = useState(null);

  async function reload(nextStatus = status) {
    try {
      setItems(await listTailoringJobs(client, backendBaseUrl, nextStatus));
    } catch (error) {
      onError(error);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function viewMatch(job) {
    modal.info({
      title: "Match explanation",
      width: 480,
      content: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 360, overflow: "auto" }}>
          {JSON.stringify(job.match_details, null, 2)}
        </pre>
      ),
    });
  }

  function viewJob(job) {
    const jd = job.job_descriptions || {};
    modal.info({
      title: jd.job_title || "Job",
      content: (
        <div>
          <div>{jd.company || ""}</div>
          <div>{jd.job_title || ""}</div>
          <div>Internal JD ID: {jd.id || ""}</div>
        </div>
      ),
    });
  }

  function cancel(job) {
    modal.confirm({
      title: "Cancel this pending tailoring job?",
      onOk: async () => {
        try {
          await cancelTailoringJob(client, backendBaseUrl, job.id);
          await reload();
        } catch (error) {
          onError(error);
        }
      },
    });
  }

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            style={{ width: 180 }}
            value={status}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setStatus(value);
              reload(value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => reload()}>
            Refresh
          </Button>
        </Space>
      </Card>
      {!items ? null : !items.length ? (
        <Card>
          <Empty description="No tailoring jobs match this view." />
        </Card>
      ) : (
        items.map((job) => (
          <QueueCard
            key={job.id}
            job={job}
            onOpen={() =>
              openTailoringResume(client, backendBaseUrl, job).catch(onError)
            }
            onViewMatch={() => viewMatch(job)}
            onViewJob={() => viewJob(job)}
            onCancel={() => cancel(job)}
          />
        ))
      )}
    </>
  );
}
