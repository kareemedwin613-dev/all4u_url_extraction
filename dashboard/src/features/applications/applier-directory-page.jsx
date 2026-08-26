import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { ErrorState, LoadingState } from "../../components/ui.jsx";
import { clientSortColumns } from "../../shared/table-sorting.js";
import { listActiveAppliers } from "./application-service.js";
import { appliersApi } from "../bulk-assignment/bulk-assignment-service.js";

const { Text } = Typography;

function profileLabel(row) {
  const name = row.resumeName || row.candidateName || "Resume";
  const candidate = row.candidateName && row.resumeName && row.candidateName !== row.resumeName
    ? ` · ${row.candidateName}`
    : "";
  const number = row.resumeNumber != null ? ` #${row.resumeNumber}` : "";
  return `${name}${candidate}${number}`;
}

export function ApplierDirectoryPage({ client, apiBaseUrl, reload }) {
  const [items, setItems] = useState();
  const [error, setError] = useState("");
  const [localReload, setLocalReload] = useState(0);
  const [edit, setEdit] = useState();
  const [options, setOptions] = useState();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  useEffect(() => {
    let live = true;
    setError("");
    listActiveAppliers(client, apiBaseUrl)
      .then((value) => live && setItems(value))
      .catch((value) => live && setError(value.message));
    return () => { live = false; };
  }, [client, apiBaseUrl, reload, localReload]);

  async function openManage(row) {
    setEdit(row);
    setModalError("");
    setOptions();
    setSelected((row.assigned_profiles || row.assignedProfiles || []).map((profile) => profile.resumeId || profile.resume_id));
    try {
      const [mapped, nextOptions] = await Promise.all([
        appliersApi.listResumeProfiles(client, apiBaseUrl, row.id),
        appliersApi.listResumeProfileOptions(client, apiBaseUrl),
      ]);
      setSelected((mapped || []).map((profile) => profile.resumeId));
      setOptions(nextOptions || []);
    } catch (failure) {
      setModalError(failure.message || "Resume profiles could not be loaded.");
      setOptions([]);
    }
  }

  async function saveProfiles() {
    if (!edit || busy) return;
    setBusy(true);
    setModalError("");
    try {
      await appliersApi.setResumeProfiles(client, apiBaseUrl, edit.id, selected);
      setEdit();
      setLocalReload((current) => current + 1);
    } catch (failure) {
      setModalError(failure.message || "Resume profiles could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const selectOptions = useMemo(() => (options || []).map((row) => {
    const ownedByOther = row.ownerApplierUserId && row.ownerApplierUserId !== edit?.id;
    return {
      value: row.resumeId,
      disabled: ownedByOther,
      label: ownedByOther
        ? `${profileLabel(row)} (assigned to ${row.ownerDisplayName || row.ownerEmail || "another Applier"})`
        : profileLabel(row),
    };
  }), [options, edit?.id]);

  const columns = clientSortColumns([
    { title: "Name", dataIndex: "display_name" },
    { title: "Email", dataIndex: "email" },
    { title: "Active Applications", dataIndex: "active_application_count" },
    {
      title: "Assigned Profiles",
      dataIndex: "assigned_profile_count",
      sortValue: (row) => Number(row.assigned_profile_count || row.assignedProfileCount || 0),
      render: (_, row) => {
        const profiles = row.assigned_profiles || row.assignedProfiles || [];
        const count = Number(row.assigned_profile_count ?? row.assignedProfileCount ?? profiles.length);
        if (!count) return <Tag>None</Tag>;
        const names = profiles.map((profile) => profile.resumeName || profile.candidateName || profile.resume_name || profile.candidate_name).filter(Boolean);
        return (
          <Space size={[4, 4]} wrap>
            <Tag color="blue">{count}</Tag>
            <Text type="secondary">{names.slice(0, 3).join(", ") || "—"}{names.length > 3 ? ` +${names.length - 3}` : ""}</Text>
          </Space>
        );
      },
    },
    {
      title: "Actions",
      sortable: false,
      render: (_, row) => <Button onClick={() => openManage(row)}>Manage Profiles</Button>,
    },
  ]);

  return (
    <div className="page">
      <Text>
        Manage which exclusive Resume profiles each active Applier may receive. Appliers with no mapped profiles cannot be assigned Applications. User status and role management remain Admin-only.
      </Text>
      {error ? <ErrorState message={error} /> : !items ? <LoadingState /> : !items.length ? (
        <Card><Empty description="No active Appliers. An Admin can assign the Applier role from User Management." /></Card>
      ) : (
        <Card>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 240px)" }}
          />
        </Card>
      )}
      <Modal
        open={!!edit}
        title={edit ? `Manage Profiles · ${edit.display_name || edit.displayName || edit.email}` : "Manage Profiles"}
        okText="Save Profiles"
        confirmLoading={busy}
        onOk={saveProfiles}
        onCancel={() => !busy && setEdit()}
        destroyOnClose
        width={720}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="This Applier cannot receive Applications until at least one profile is assigned."
        />
        {modalError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={modalError} />}
        {!options ? <LoadingState text="Loading resumes…" /> : (
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            placeholder="Select active original Resumes"
            value={selected}
            options={selectOptions}
            onChange={setSelected}
          />
        )}
        {!selected.length && options && (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            Saving with no profiles selected leaves this Applier unable to receive Applications.
          </Text>
        )}
      </Modal>
    </div>
  );
}
