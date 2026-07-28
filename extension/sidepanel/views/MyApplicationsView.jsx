import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Select, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { listMyApplications } from "../../services/application-service.js";
import { ApplicationCard } from "../components/ApplicationCard.jsx";
import { ApplicationStatusModal } from "../components/ApplicationStatusModal.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "NOT_APPLIED", label: "Not Applied" },
  { value: "APPLIED", label: "Applied" },
  { value: "SCREENING", label: "Screening" },
  { value: "INTERVIEW_SCHEDULED", label: "Interview Scheduled" },
  { value: "OFFER_RECEIVED", label: "Offer Received" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "CLOSED", label: "Closed" },
];

export function MyApplicationsView({ client, backendBaseUrl, onStatus, onError }) {
  const [applicationStatus, setApplicationStatus] = useState("");
  const [resumeFilter, setResumeFilter] = useState("");
  const [items, setItems] = useState(null);
  const [editingApplication, setEditingApplication] = useState(null);

  async function reload(nextStatus = applicationStatus) {
    try {
      setItems(await listMyApplications(client, backendBaseUrl, { applicationStatus: nextStatus }));
    } catch (error) {
      onError(error);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeOptions = useMemo(() => {
    const names = [...new Set((items || []).map((application) => application.resume_name).filter(Boolean))].sort();
    return [{ value: "", label: "All resumes" }, ...names.map((name) => ({ value: name, label: name }))];
  }, [items]);

  const filteredItems = useMemo(
    () => (items || []).filter((application) => !resumeFilter || application.resume_name === resumeFilter),
    [items, resumeFilter],
  );

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            style={{ width: 200 }}
            value={applicationStatus}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setApplicationStatus(value);
              reload(value);
            }}
          />
          <Select
            style={{ width: 200 }}
            value={resumeFilter}
            options={resumeOptions}
            onChange={setResumeFilter}
            placeholder="Filter by resume"
          />
          <Button icon={<ReloadOutlined />} onClick={() => reload()}>
            Refresh
          </Button>
        </Space>
      </Card>
      {!items ? null : !filteredItems.length ? (
        <Card>
          <Empty
            description={
              items.length ? "No Applications match this resume filter." : "No Applications are currently assigned to you."
            }
          />
        </Card>
      ) : (
        filteredItems.map((application) => (
          <ApplicationCard key={application.id} application={application} onUpdateStatus={setEditingApplication} />
        ))
      )}
      {editingApplication && (
        <ApplicationStatusModal
          application={editingApplication}
          client={client}
          backendBaseUrl={backendBaseUrl}
          onClose={() => setEditingApplication(null)}
          onSaved={() => {
            setEditingApplication(null);
            reload();
          }}
          onStatus={onStatus}
          onError={onError}
        />
      )}
    </>
  );
}
