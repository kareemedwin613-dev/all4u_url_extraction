import React, { useEffect } from "react";
import { Alert, Col, Form, Input, Modal, Row, Select } from "antd";
import {
  INTERVIEW_LOCATIONS,
  INTERVIEW_STAGES,
  INTERVIEW_STATUSES,
  INTERVIEW_TYPES,
  JOB_TYPES,
} from "./interview-model.js";

const options = (pairs) => pairs.map(([value, label]) => ({ value, label }));

export function InterviewFormModal({ open, title, initial, manager, interviewees = [], busy, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (open && initial) form.setFieldsValue(initial);
  }, [open, initial, form]);
  const applicationId = initial?.applicationId || "";
  const applicationNumber = String(initial?.applicationNumber || "").trim();
  const heading = applicationNumber ? `${title} · Application #${applicationNumber}` : title;
  return (
    <Modal
      open={open}
      title={heading}
      width={1040}
      centered
      styles={{ body: { maxHeight: "calc(100vh - 200px)", overflowY: "auto", overflowX: "hidden" } }}
      onCancel={onCancel}
      maskClosable={false}
      keyboard={false}
      destroyOnHidden
      okText="Save interview"
      confirmLoading={busy}
      onOk={() => form.submit()}
    >
      {!initial ? (
        <Alert type="info" showIcon message="Loading the Application…" />
      ) : (
        <Form form={form} layout="vertical" initialValues={initial} onFinish={onSubmit} disabled={busy}>
          {!manager && !applicationId ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Link this interview to an Application"
              description="Open the Application and set its status to Interview Scheduled. That opens this form with the company and profile filled in."
            />
          ) : null}
          {applicationId ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={<a href={`#/applications/${applicationId}`}>Linked Application</a>}
            />
          ) : null}
          <Form.Item name="applicationId" hidden={!manager || Boolean(applicationId)} label={manager && !applicationId ? "Application ID" : undefined}>
            {manager && !applicationId ? <Input placeholder="Optional until this invite is linked" /> : <Input type="hidden" />}
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Interview Starts" name="startsAt" rules={[{ required: true, message: "Enter a start time." }]}>
                <Input type="datetime-local" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Interview Ends" name="endsAt" rules={[{ required: true, message: "Enter an end time." }]}>
                <Input type="datetime-local" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Applied Date" name="appliedDate">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Interviewee" name="intervieweeUserId" rules={[{ required: true, message: "Select an interviewee." }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={interviewees.length ? "Select an interviewee" : "Assign the Interviewee role to a user first"}
                  options={interviewees.map((person) => ({ value: person.id, label: person.fullName || person.email }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Profile Name" name="profileName">
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Profile Email" name="profileEmail">
                <Input maxLength={320} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Profile Phone Number" name="profilePhone">
                <Input maxLength={60} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Profile LinkedIn URL" name="linkedinUrl">
                <Input maxLength={4000} placeholder="https://" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Company" name="companyName" rules={[{ required: true, message: "Enter the company name." }]}>
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Company Website URL" name="companyWebsite">
                <Input maxLength={4000} placeholder="https://" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Job Link" name="jobLink">
                <Input maxLength={4000} placeholder="https://" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Role" name="roleTitle">
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Job Type" name="jobType">
                <Select allowClear options={options(JOB_TYPES)} placeholder="Full-Time, Part-Time, or Contract" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Location" name="location">
                <Select allowClear options={options(INTERVIEW_LOCATIONS)} placeholder="Remote, On-Site, or Hybrid" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Stage" name="stage">
                <Select options={options(INTERVIEW_STAGES)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Status" name="status">
                <Select options={options(INTERVIEW_STATUSES)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Salary Range" name="salaryRange">
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Interviewer(s) Name" name="interviewers">
                <Input maxLength={500} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Interviewer(s) Position" name="interviewerPosition">
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Interviewer(s) Location" name="interviewerLocation">
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Recruiter Name" name="recruiterName">
                <Input maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Recruiter Email" name="recruiterEmail">
                <Input maxLength={320} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Recruiter Phone Number" name="recruiterPhone">
                <Input maxLength={60} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Resume Link" name="resumeLink">
                <Input maxLength={4000} placeholder="https://" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Interview Type" name="interviewType">
                <Select options={options(INTERVIEW_TYPES)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Meeting Link" name="meetingUrl">
                <Input maxLength={4000} placeholder="https://" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="Detailed Information" name="detailedInformation">
                <Input.TextArea rows={3} maxLength={4000} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="professionalStack" hidden><Input /></Form.Item>
          <Form.Item name="place" hidden><Input /></Form.Item>
          <Form.Item name="notes" hidden><Input /></Form.Item>
        </Form>
      )}
    </Modal>
  );
}
