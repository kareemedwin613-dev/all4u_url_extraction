import React, { useEffect, useState } from "react";
import { App as AntdApp, Alert, Button, Form, Input, List, Modal, Select, Space, Upload } from "antd";
import { DeleteOutlined, PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import {
  attachApplicationScreenshot,
  listApplicationScreenshots,
  removeApplicationScreenshot,
  updateApplicationProgress,
  openApplicationScreenshot,
} from "../../services/application-service.js";

const STATUS_OPTIONS = [
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "APPLIED", label: "Applied" },
  { value: "SCREENING", label: "Screening" },
  { value: "INTERVIEW_SCHEDULED", label: "Interview Scheduled" },
  { value: "OFFER_RECEIVED", label: "Offer Received" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "CLOSED", label: "Closed" },
];

export function ApplicationStatusModal({ application, client, backendBaseUrl, onClose, onSaved, onError, onStatus }) {
  const { modal } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [screenshots, setScreenshots] = useState([]);
  const [loadingScreenshots, setLoadingScreenshots] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    listApplicationScreenshots(client, backendBaseUrl, application.id)
      .then((rows) => live && setScreenshots(rows))
      .catch((error) => live && onError(error))
      .finally(() => live && setLoadingScreenshots(false));
    return () => {
      live = false;
    };
  }, [client, backendBaseUrl, application.id, onError]);

  async function handleUpload(file) {
    setUploading(true);
    try {
      await attachApplicationScreenshot(client, backendBaseUrl, application.id, file);
      setScreenshots(await listApplicationScreenshots(client, backendBaseUrl, application.id));
      onStatus({ message: "Screenshot attached.", kind: "success" });
    } catch (error) {
      onError(error);
    } finally {
      setUploading(false);
    }
    return false;
  }

  function handleRemove(screenshot) {
    modal.confirm({
      title: "Remove this screenshot?",
      content: screenshot.original_filename,
      onOk: async () => {
        try {
          await removeApplicationScreenshot(client, backendBaseUrl, application.id, screenshot);
          setScreenshots((rows) => rows.filter((row) => row.id !== screenshot.id));
        } catch (error) {
          onError(error);
        }
      },
    });
  }

  async function submit(values) {
    if (
      values.status === "APPLIED" &&
      application.status !== "APPLIED" &&
      (!(values.applicationUrl || application.application_url) || !screenshots.length)
    ) {
      onStatus({
        message: "Add a Confirmation URL and attach at least one confirmation screenshot before marking this Applied.",
        kind: "error",
      });
      return;
    }
    if (values.status === "BLOCKED" && !String(values.notes || "").trim()) {
      onStatus({
        message: "Add a note explaining why this Application is blocked.",
        kind: "error",
      });
      return;
    }
    setSaving(true);
    try {
      await updateApplicationProgress(client, backendBaseUrl, application.id, {
        status: values.status,
        applicationUrl: values.applicationUrl,
        notes: values.notes,
      });
      onStatus({ message: "Application updated.", kind: "success" });
      onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`${application.company} — ${application.job_title}`} onCancel={onClose} footer={null} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          status: application.status,
          applicationUrl: application.application_url || "",
          notes: application.notes || "",
        }}
        onFinish={submit}
      >
        <Form.Item label="Status" name="status">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>
        <Form.Item
          label="Notes"
          name="notes"
          extra="Required when status is Blocked (e.g. expired posting, site error)."
          rules={[{ max: 10000, message: "Notes cannot exceed 10000 characters." }]}
        >
          <Input.TextArea
            rows={4}
            maxLength={10000}
            showCount
            placeholder="Explain blockers, expired JD, missing info, etc."
          />
        </Form.Item>
        <Form.Item
          label="Confirmation URL"
          name="applicationUrl"
          rules={[{ type: "url", warningOnly: true, message: "Enter a valid URL." }]}
        >
          <Input type="url" maxLength={4000} placeholder="https://..." />
        </Form.Item>
        <Form.Item label="Confirmation screenshots">
          <List
            size="small"
            bordered
            loading={loadingScreenshots}
            locale={{ emptyText: "No screenshots attached yet." }}
            dataSource={screenshots}
            renderItem={(screenshot) => (
              <List.Item
                actions={[
                  <Button
                    key="remove"
                    size="small"
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemove(screenshot)}
                  />,
                ]}
              >
                <Button
                  type="link"
                  icon={<PaperClipOutlined />}
                  onClick={() =>
                    openApplicationScreenshot(client, backendBaseUrl, application.id, screenshot).catch(onError)
                  }
                >
                  {screenshot.original_filename}
                </Button>
              </List.Item>
            )}
          />
          <Upload accept=".png,.jpg,.jpeg,.webp,.pdf" showUploadList={false} beforeUpload={handleUpload}>
            <Button icon={<UploadOutlined />} loading={uploading} style={{ marginTop: 8 }}>
              Add screenshot
            </Button>
          </Upload>
        </Form.Item>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Marking Applied for the first time requires a Confirmation URL and at least one screenshot."
        />
        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </Space>
      </Form>
    </Modal>
  );
}
